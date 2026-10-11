/**
 * Scan orchestrator.
 *
 * Runs the full pipeline for one coordinate and returns a complete, persisted-
 * ready resolution. It never throws for an expected failure: errors are turned
 * into an explicit ERROR outcome so the caller cannot accidentally treat a
 * failed scan as a clean one.
 */

import { queryOsv } from "./advisories.ts";
import {
  advisoryFindings,
  detectLifecycleScripts,
  detectMetadata,
  detectSourcePatterns,
} from "./detect.ts";
import { HttpError, safeFetch } from "./http.ts";
import { evaluatePolicy } from "./policy.ts";
import { resolvePackage, TARBALL_MAX_BYTES, TARBALL_TIMEOUT_MS, verifyIntegrity } from "./registry.ts";
import { readTarball, TarballError, type TarballContents } from "./tarball.ts";
import {
  POLICY_VERSION,
  SCANNER_VERSION,
  type DependencyInfo,
  type ScanResolution,
} from "./types.ts";

/** Injected for tests; defaults to the real hardened client. */
export interface ScanDeps {
  fetchImpl?: typeof safeFetch;
  advisoriesImpl?: typeof queryOsv;
  now?: () => number;
}

export interface ScanOutcome {
  ok: boolean;
  resolution?: ScanResolution;
  /** Machine-readable failure. Present when ok === false. */
  error?: { code: string; message: string };
  /**
   * The already-inspected archive, handed to the attestation stage so the
   * package is downloaded exactly once per scan.
   */
  contents?: TarballContents;
  integrityVerified?: boolean;
  integrityNote?: string | null;
}

function dep<T>(impl: T | undefined, fallback: T): T {
  return impl ?? fallback;
}

export async function runScan(requested: string, deps: ScanDeps = {}): Promise<ScanOutcome> {
  const startedMs = dep(deps.now, Date.now)();
  const incompleteChecks: string[] = [];

  /* ---- 1. Resolve the coordinate --------------------------------------- */
  let resolved;
  try {
    // Metadata resolution uses the same injected client, so no part of the
    // pipeline reaches the network during tests.
    resolved = await resolvePackage(requested, dep(deps.fetchImpl, safeFetch));
  } catch (err) {
    const code = err instanceof HttpError || (err as { code?: string }).code ? String((err as { code: string }).code) : "DZ_RESOLVE_FAILED";
    const message = (err as Error).message ?? "Package could not be resolved.";
    // A registry outage is an ERROR. It is never allowed to read as "clean".
    return { ok: false, error: { code, message } };
  }

  /* ---- 2. Download the tarball ----------------------------------------- */
  const fetchImpl = dep(deps.fetchImpl, safeFetch);
  let tarball: Buffer;
  let artifactSha256: string;
  let tarballBytes: number;

  try {
    const res = await fetchImpl(
      resolved.tarballUrl,
      { timeoutMs: TARBALL_TIMEOUT_MS, maxBytes: TARBALL_MAX_BYTES },
    );
    tarball = res.bytes;
    artifactSha256 = res.sha256;
    tarballBytes = res.bytes.length;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "DZ_TARBALL_DOWNLOAD";
    return { ok: false, error: { code, message: (err as Error).message } };
  }

  /* ---- 3. Verify integrity --------------------------------------------- */
  const integrity = verifyIntegrity(tarball, resolved.integrity, resolved.shasum);
  if (!integrity.ok) {
    return { ok: false, error: { code: "DZ_INTEGRITY", message: integrity.reason ?? "Integrity check failed." } };
  }
  if (integrity.reason) incompleteChecks.push(integrity.reason);

  /* ---- 4. Inspect the archive ------------------------------------------ */
  let contents;
  try {
    contents = readTarball(tarball);
  } catch (err) {
    const code = err instanceof TarballError ? err.code : "DZ_TAR_UNKNOWN";
    return { ok: false, error: { code, message: (err as Error).message } };
  }

  if (contents.truncated) {
    incompleteChecks.push(
      "Archive inspection hit a safety limit and did not read every entry; some files were not analysed.",
    );
  }

  /* ---- 5. Detectors ------------------------------------------------------ */
  const findings = [
    ...detectLifecycleScripts(resolved.scripts),
    ...detectSourcePatterns(contents.entries),
  ];

  const advisories = await dep(deps.advisoriesImpl, queryOsv)(resolved.name, resolved.version);
  if (advisories.state === "unavailable") {
    incompleteChecks.push(
      `Vulnerability data could not be retrieved (${advisories.error ?? "advisory service unavailable"}).`,
    );
  }
  findings.push(...advisoryFindings(advisories.vulnerabilities));

  findings.push(
    ...detectMetadata({
      deprecated: resolved.deprecated,
      advisoriesUnavailable: advisories.state === "unavailable" ? advisories.error : undefined,
      rejectedEntries: contents.rejected,
    }),
  );

  /* ---- 6. Policy -------------------------------------------------------- */
  const decision = evaluatePolicy({ findings, incompleteChecks });

  const dependencies: DependencyInfo = {
    direct: Object.entries(resolved.dependencies).map(([name, range]) => ({ name, range })),
    transitiveResolved: false,
    note:
      "Only the scanned package's own manifest was read. Transitive dependencies were not resolved in this phase, so this is not a complete dependency audit.",
  };

  const completedMs = dep(deps.now, Date.now)();

  const resolution: ScanResolution = {
    requested,
    resolvedName: resolved.name,
    resolvedVersion: resolved.version,
    registry: resolved.registry,
    artifactSha256,
    tarballBytes,
    fileCount: contents.fileCount,
    inspectedBytes: contents.expandedBytes,
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    durationMs: completedMs - startedMs,
    scannerVersion: SCANNER_VERSION,
    policyVersion: POLICY_VERSION,
    riskScore: decision.riskScore,
    verdict: decision.verdict,
    rationale: decision.rationale,
    findings,
    dependencies,
    advisories,
    incompleteChecks,
    metadata: {
      publisher: resolved.publisher,
      license: resolved.license,
      repository: resolved.repository,
      publishedAt: resolved.publishedAt,
      modifiedAt: resolved.modifiedAt,
      unpackedSize: resolved.unpackedSize,
      fileCount: resolved.fileCount,
      description: resolved.description,
    },
  };

  return { ok: true, resolution, contents, integrityVerified: integrity.ok, integrityNote: integrity.reason ?? null };
}
