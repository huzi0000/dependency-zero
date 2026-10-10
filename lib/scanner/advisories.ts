/**
 * OSV advisory lookup.
 *
 * Querying a real advisory service is a mandatory check, and its failure mode
 * matters: an unreachable advisory API must never be reported as "no known
 * vulnerabilities". It returns `state: "unavailable"`, which the policy engine
 * treats as an incomplete check.
 */

import { safeFetch, HttpError } from "./http.ts";
import type { AdvisoryResult, Severity } from "./types.ts";

const OSV_QUERY = "https://api.osv.dev/v1/query";
const OSV_TIMEOUT_MS = 12_000;
const OSV_MAX_BYTES = 2 * 1024 * 1024;

const SEVERITY_MAP: Record<string, Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  MEDIUM: "medium",
  LOW: "low",
};

/** Map an OSV affected[].severity entry to our vocabulary, conservatively. */
function severityFromOsv(entry: {
  severity?: { type?: string; score?: string }[];
  database_specific?: { severity?: string };
}): Severity {
  const fromDb = entry.database_specific?.severity?.toUpperCase();
  if (fromDb && fromDb in SEVERITY_MAP) return SEVERITY_MAP[fromDb];

  for (const s of entry.severity ?? []) {
    if (s.type === "CVSS_V3" && s.score) {
      // CVSS base score -> band. Conservative: unknown stays medium.
      const n = Number(s.score);
      if (Number.isFinite(n)) {
        if (n >= 9) return "critical";
        if (n >= 7) return "high";
        if (n >= 4) return "medium";
        return "low";
      }
    }
  }
  return "medium";
}

export async function queryOsv(name: string, version: string): Promise<AdvisoryResult> {
  try {
    const res = await safeFetch(
      OSV_QUERY,
      { timeoutMs: OSV_TIMEOUT_MS, maxBytes: OSV_MAX_BYTES },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          package: { ecosystem: "npm", name },
          version,
        }),
      },
    );

    let doc: { vulns?: unknown[] };
    try {
      doc = JSON.parse(res.bytes.toString("utf8")) as { vulns?: unknown[] };
    } catch {
      return { state: "unavailable", vulnerabilities: [], error: "OSV returned malformed JSON." };
    }

    const vulns = Array.isArray(doc.vulns) ? doc.vulns : [];
    const vulnerabilities = vulns.map((raw) => {
      const v = raw as {
        id?: string;
        summary?: string;
        database_specific?: { severity?: string };
        severity?: { type?: string; score?: string }[];
        references?: { type?: string; url?: string }[];
      };
      const url = v.references?.find((r) => r.type === "ADVISORY" || r.type === "FIX")?.url;
      return {
        id: v.id ?? "UNKNOWN",
        source: "OSV",
        url,
        summary: v.summary,
        severity: severityFromOsv(v),
      };
    });

    return { state: "checked", vulnerabilities };
  } catch (err) {
    // Explicitly recorded as unavailable. Never collapsed into "clean".
    const message = err instanceof HttpError ? `${err.code}: ${err.message}` : String(err);
    return { state: "unavailable", vulnerabilities: [], error: message };
  }
}
