/**
 * Detectors.
 *
 * Each detector reports what it actually observed in the scanned bytes. None of
 * them assert that a package is malicious; they emit evidence and let the
 * policy engine decide.
 *
 * Two rules matter for honesty and are enforced throughout:
 *
 *  1. A `postinstall` script is NOT malicious on its own. D0-LC-006 records that
 *     install-time code exists; it never blocks by itself.
 *  2. `child_process`, `eval`, network access and minified output are ordinary
 *     in real packages. Those rules are low-confidence and only contribute when
 *     corroborated (e.g. env access + obfuscation + exfil shape together).
 */

import { RULE_BY_ID, RULES, type RuleDef } from "./rules.ts";
import type { Evidence, Finding, Severity } from "./types.ts";
import type { TarEntry } from "./tarball.ts";

const MAX_SNIPPET = 160;
const MAX_EVIDENCE_PER_FINDING = 3;
/** Files larger than this are not content-scanned; they are still counted. */
const MAX_SCAN_FILE_BYTES = 512 * 1024;
/** Bound how many files we regex, so a huge package cannot blow up the scan. */
const MAX_SCANNED_FILES = 2_000;

const SOURCE_EXT = /\.(m?js|c?js|ts|mts|cts|jsx|tsx|json|sh|bash|zsh|py|ps1|cmd)$/i;

function snippet(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_SNIPPET ? `${trimmed.slice(0, MAX_SNIPPET)}…` : trimmed;
}

function finding(
  ruleId: string,
  detail: string,
  evidence: Evidence[],
  opts: { confidence?: Finding["confidence"]; severity?: Severity } = {},
): Finding | null {
  const rule: RuleDef | undefined = RULE_BY_ID.get(ruleId);
  if (!rule) return null;
  return {
    ruleId,
    severity: opts.severity ?? rule.severity,
    title: rule.title,
    detail,
    evidence: evidence.slice(0, MAX_EVIDENCE_PER_FINDING),
    confidence: opts.confidence ?? "medium",
    kind: "heuristic",
  };
}

/* -------------------------------------------------------------------------- */
/* Line scanning helper                                                        */
/* -------------------------------------------------------------------------- */

interface LineHit {
  line: number;
  text: string;
}

/**
 * Run a set of named regexes over a text file and return the first hit per
 * rule, with a real line number. Regexes are applied per-line so the reported
 * line number always refers to the actual line that matched.
 */
function scanLines(
  text: string,
  patterns: { ruleId: string; re: RegExp }[],
): Map<string, LineHit[]> {
  const out = new Map<string, LineHit[]>();
  const lines = text.split(/\r?\n/);
  // Cap lines examined; the tail of a generated bundle is rarely informative.
  const limit = Math.min(lines.length, 20_000);

  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (!line || line.length > 4000) continue;
    for (const { ruleId, re } of patterns) {
      // `g` flags would make .test() stateful across lines.
      if (re.test(line)) {
        const arr = out.get(ruleId) ?? [];
        if (arr.length < MAX_EVIDENCE_PER_FINDING) {
          arr.push({ line: i + 1, text: snippet(line) });
          out.set(ruleId, arr);
        }
      }
    }
  }
  return out;
}

function toEvidence(file: string, hits: LineHit[]): Evidence[] {
  return hits.map((h) => ({ file, line: h.line, snippet: h.text }));
}

/* -------------------------------------------------------------------------- */
/* Detector A - lifecycle scripts                                              */
/* -------------------------------------------------------------------------- */

const LIFECYCLE_KEYS = ["preinstall", "install", "postinstall", "prepare", "preprepare", "postprepare"];

const LIFECYCLE_PATTERNS: { ruleId: string; re: RegExp }[] = [
  // curl/wget piped into a shell: the canonical remote-code-execution installer.
  {
    ruleId: "D0-LC-001",
    re: /\b(?:curl|wget|fetch)\b[^|;]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/i,
  },
  // Same idea expressed with a temp file then executed.
  {
    ruleId: "D0-LC-002",
    re: /(?:curl|wget)\b[^;&|]*(?:-o|--output)\s*\S+[^;&|]*&&[^\n]*\b(?:chmod\s+\+x|\.\/|\bnode\b|\bsh\b)/i,
  },
  { ruleId: "D0-LC-003", re: /\b(?:ba|z|k|da)?sh\s+-c\b|child_process|\bexecSync\b|\bspawnSync\b/i },
  {
    ruleId: "D0-LC-004",
    re: /~\/\.aws\/credentials|~\/\.npmrc|~\/\.ssh\/|\.ssh\/id_(?:rsa|ed25519)|\/etc\/shadow|\.docker\/config\.json|~?\/\.config\/gcloud/i,
  },
  { ruleId: "D0-LC-005", re: /\b(?:curl|wget|nc|scp|rsync)\b.*\$\{?[A-Za-z_]*(?:TOKEN|KEY|SECRET|PASS|CRED)/i },
];

export function detectLifecycleScripts(
  scripts: Record<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  const active = LIFECYCLE_KEYS.filter((k) => typeof scripts[k] === "string" && scripts[k].trim().length > 0);

  // Record that install-time code exists. Explicitly informational (D0-LC-006).
  if (active.length > 0) {
    findings.push(
      finding(
        "D0-LC-006",
        `The package defines install-time scripts: ${active.join(", ")}. Lifecycle scripts are common in legitimate packages and are not treated as malicious by themselves.`,
        [{ file: "package.json", line: null, snippet: active.map((k) => `"${k}": "${scripts[k]}"`).join(" | ") }],
        { confidence: "high", severity: "low" },
      )!,
    );
  }

  for (const key of active) {
    const body = scripts[key];
    const hits = scanLines(body, LIFECYCLE_PATTERNS);
    for (const [ruleId, matched] of hits) {
      const rule = RULE_BY_ID.get(ruleId);
      const evidence = toEvidence(`package.json (scripts.${key})`, matched);
      findings.push(
        finding(
          ruleId,
          `Install script "${key}" matches ${rule?.title ?? ruleId}. ${rule?.description ?? ""}`,
          evidence,
          // A curl|sh in an install script is unambiguous; the softer rules
          // are medium confidence because build tooling produces similar text.
          { confidence: ruleId === "D0-LC-001" ? "high" : "medium" },
        )!,
      );
    }
  }

  return dedupe(findings);
}

/* -------------------------------------------------------------------------- */
/* Detector B - source patterns                                                */
/* -------------------------------------------------------------------------- */

const SOURCE_PATTERNS: { ruleId: string; re: RegExp }[] = [
  { ruleId: "D0-SRC-001", re: /process\.env|os\.environ|getenv\s*\(/ },
  /*
   * D0-SRC-002 targets credential STORAGE specifically.
   *
   * A previous version included a bare `Cookies`, which matched ordinary
   * cookie handling (`'cookieSession'` in express/lib/express.js) and produced
   * a false "reaches for credential files" finding on a legitimate package.
   * Only genuine credential-store paths are matched now.
   */
  {
    ruleId: "D0-SRC-002",
    re: /\.aws\/|\.ssh\/|\.npmrc|\bid_rsa\b|\.netrc\b|Login Data|key4\.db|logins\.json|\/etc\/shadow/i,
  },
  {
    ruleId: "D0-SRC-003",
    re: /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*['"`]/,
  },
  {
    ruleId: "D0-SRC-004",
    re: /Buffer\.from\(\s*[^)]*['"`][A-Za-z0-9+/=]{40,}['"`]|\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}|atob\s*\(|String\.fromCharCode\s*\(/i,
  },
  /*
   * D0-SRC-005 must match real child-process spawning ONLY.
   *
   * An earlier version included a bare `\bexec\s*\(` which matched
   * `SOME_REGEX.exec(comment)` in @babel/core and produced a false "spawns a
   * child process" finding on a very large, legitimate package. Every
   * alternative below is either an explicit child_process import or a
   * well-known spawn API, so a RegExp method call can no longer trigger it.
   */
  {
    ruleId: "D0-SRC-005",
    re:
      /require\(\s*['"](?:node:)?child_process['"]\s*\)|from\s+['"](?:node:)?child_process['"]|\bchild_process\.\s*(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\b|\bspawnSync\s*\(|\bexecFileSync\s*\(/,
  },
  { ruleId: "D0-SRC-006", re: /\bfetch\s*\(|axios|https?\.request|XMLHttpRequest|\bnet\.(connect|Socket)\b|require\(['"]https?['"]\)/ },
];

export function detectSourcePatterns(entries: TarEntry[]): Finding[] {
  const collected = new Map<string, Evidence[]>();
  let scanned = 0;

  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.bytes) continue;
    if (!SOURCE_EXT.test(entry.path)) continue;
    if (entry.size > MAX_SCAN_FILE_BYTES) continue;
    if (scanned >= MAX_SCANNED_FILES) break;

    // Only content that is plausibly text. Binary is skipped rather than
    // regex-matched, which would just produce noise.
    const head = entry.bytes.subarray(0, 512);
    if (head.includes(0)) continue;

    scanned += 1;
    let text: string;
    try {
      text = entry.bytes.toString("utf8");
    } catch {
      continue;
    }

    const hits = scanLines(text, SOURCE_PATTERNS);
    for (const [ruleId, matched] of hits) {
      const arr = collected.get(ruleId) ?? [];
      if (arr.length < MAX_EVIDENCE_PER_FINDING) {
        arr.push(...toEvidence(entry.path, matched));
        collected.set(ruleId, arr.slice(0, MAX_EVIDENCE_PER_FINDING));
      }
    }
  }

  const findings: Finding[] = [];

  // Corroboration: the D0-SRC-001 rule only means anything alongside dynamic
  // execution or obfuscation. On its own, reading process.env is normal.
  const envHit = collected.get("D0-SRC-001");
  const obfuscated = Boolean(collected.get("D0-SRC-004"));
  const dynamicExec = Boolean(collected.get("D0-SRC-003"));
  const credentials = Boolean(collected.get("D0-SRC-002"));
  const network = Boolean(collected.get("D0-SRC-006"));

  if (envHit) {
    const corroborated = obfuscated || dynamicExec;
    findings.push(
      finding(
        "D0-SRC-001",
        corroborated
          ? "Source enumerates the process environment and also contains obfuscated or dynamic execution. Together these are the shape of credential harvesting."
          : "Source enumerates the process environment. This is extremely common in legitimate packages and is reported for review, not as evidence of theft on its own.",
        envHit,
        { confidence: corroborated ? "high" : "low" },
      )!,
    );
  }

  for (const ruleId of ["D0-SRC-002", "D0-SRC-003", "D0-SRC-004", "D0-SRC-005", "D0-SRC-006"]) {
    const ev = collected.get(ruleId);
    if (!ev) continue;
    const rule = RULE_BY_ID.get(ruleId);
    let detail = `${rule?.description ?? ""}`;
    let confidence: Finding["confidence"] = "low";

    if (ruleId === "D0-SRC-002" && (envHit || dynamicExec) && network) {
      detail += " Combined with environment access and outbound network activity, this is the shape of credential exfiltration.";
      confidence = "high";
    } else if (ruleId === "D0-SRC-003" && obfuscated) {
      detail += " Paired with obfuscated string reconstruction, this indicates concealed execution.";
      confidence = "medium";
    } else if (ruleId === "D0-SRC-004" && dynamicExec) {
      detail += " The reconstructed value is then executed dynamically.";
      confidence = "medium";
    }

    findings.push(finding(ruleId, detail, ev, { confidence })!);
  }

  return dedupe(findings);
}

/* -------------------------------------------------------------------------- */
/* Detector C - metadata                                                       */
/* -------------------------------------------------------------------------- */

export function detectMetadata(opts: {
  deprecated?: string;
  advisoriesUnavailable?: string;
  rejectedEntries: { path: string; reason: string }[];
}): Finding[] {
  const findings: Finding[] = [];

  if (opts.deprecated) {
    findings.push(
      finding(
        "D0-META-002",
        `The registry marks this version as deprecated: ${opts.deprecated}`,
        [{ file: "package.json", line: null, snippet: opts.deprecated }],
        { confidence: "high" },
      )!,
    );
  }

  if (opts.advisoriesUnavailable) {
    findings.push(
      finding(
        "D0-META-003",
        `Vulnerability checking did not complete: ${opts.advisoriesUnavailable}. This is not the same as "no vulnerabilities found".`,
        [{ file: "package.json", line: null, snippet: `name@version (unverified)` }],
        { confidence: "high", severity: "info" },
      )!,
    );
  }

  if (opts.rejectedEntries.length > 0) {
    const sample = opts.rejectedEntries.slice(0, 3);
    findings.push(
      finding(
        "D0-META-004",
        `The archive contained ${opts.rejectedEntries.length} unsafe or unsupported entr${
          opts.rejectedEntries.length === 1 ? "y" : "ies"
        }, which were refused and never inspected.`,
        sample.map((r) => ({ file: r.path, line: null, snippet: r.reason })),
        { confidence: "high", severity: "info" },
      )!,
    );
  }

  return findings;
}

/** Turn OSV records into advisory findings with explicit attribution. */
export function advisoryFindings(vulns: {
  id: string;
  source: string;
  url?: string;
  summary?: string;
  severity?: Severity;
}[]): Finding[] {
  return vulns.map((v) => {
    const rule = RULE_BY_ID.get("D0-META-001")!;
    return {
      ruleId: rule.id,
      severity: v.severity ?? rule.severity,
      title: rule.title,
      detail:
        `Advisory ${v.id} (${v.source}) affects this exact package and version.` +
        (v.summary ? ` ${v.summary}` : ""),
      evidence: [
        {
          file: `advisory:${v.id}`,
          line: null,
          snippet: `${v.source}:${v.id}`,
        },
      ],
      confidence: "high" as const,
      kind: "advisory" as const,
      source: { name: v.source, id: v.id, url: v.url },
    };
  });
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.ruleId}|${f.evidence[0]?.file ?? ""}|${f.evidence[0]?.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export { RULES };
