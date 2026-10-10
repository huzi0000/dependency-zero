/**
 * Scanner domain types.
 *
 * Kept separate from `lib/types.ts` (the existing UI contract) so the console
 * keeps reading exactly the fields it already reads. Everything here is
 * additive.
 *
 * BACKWARD COMPATIBILITY: every field on a persisted scan is optional or
 * defaults safely, so the 78 records written before the real scanner existed
 * still load, still render, and are never silently reinterpreted.
 */

/** Build identity, stamped on every scan so results are attributable. */
export const SCANNER_VERSION = "d0-scanner/1.0.0";

/**
 * Policy identity. Any change to scoring or thresholds MUST bump this, because
 * a risk score is only reproducible alongside the policy that produced it.
 */
export const POLICY_VERSION = "d0-policy/1.0.0";

/**
 * Scan lifecycle, deliberately separate from the security verdict.
 *
 * A scan that is still QUEUED has no opinion about the package. Collapsing
 * "not finished" into "safe" is the exact failure mode this separation exists
 * to prevent.
 */
export type ScanPhase = "queued" | "scanning" | "completed" | "error";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

/** One piece of real, quotable evidence. Every field comes from scanned bytes. */
export interface Evidence {
  /** Path inside the tarball, e.g. "package/postinstall.js". Never invented. */
  file: string;
  /** 1-based line number when the detector could localise it, else null. */
  line: number | null;
  /** The exact matched text, trimmed and length-bounded. */
  snippet: string;
}

export interface Finding {
  /** Stable rule id, e.g. "D0-LC-001". Documented in lib/scanner/rules.ts. */
  ruleId: string;
  severity: Severity;
  /** Short human title. */
  title: string;
  /** Why this fired, in plain language. */
  detail: string;
  evidence: Evidence[];
  /**
   * "high"  = the pattern is unambiguous given context
   * "medium"= pattern plus a corroborating signal
   * "low"   = pattern alone, weak on its own
   */
  confidence: "low" | "medium" | "high";
  /** "heuristic" findings are pattern matches, NOT confirmed malware. */
  kind: "heuristic" | "advisory" | "policy";
  /** Advisory provenance, present only for kind === "advisory". */
  source?: { name: string; id?: string; url?: string };
}

export interface AdvisoryResult {
  /** "checked" only when the advisory API actually answered. */
  state: "checked" | "unavailable";
  vulnerabilities: {
    id: string;
    source: string;
    url?: string;
    summary?: string;
    severity?: Severity;
  }[];
  /** Present when state === "unavailable". Never silently treated as "clean". */
  error?: string;
}

export interface DependencyInfo {
  /** Direct dependencies exactly as declared in the package's own manifest. */
  direct: { name: string; range: string }[];
  /**
   * Explicitly partial. We only read the manifest of the scanned package; we
   * do NOT resolve the full transitive graph in this phase, and the UI must
   * label it as such rather than implying a complete audit.
   */
  transitiveResolved: false;
  note: string;
}

export interface ScanResolution {
  /** The coordinate the user asked for, verbatim. */
  requested: string;
  /** What the registry actually resolved to. */
  resolvedName: string;
  resolvedVersion: string;
  /** Registry the metadata came from, e.g. "https://registry.npmjs.org". */
  registry: string;
  /** SHA-256 of the tarball bytes we downloaded and inspected. */
  artifactSha256: string;
  tarballBytes: number;
  fileCount: number;
  /** Total expanded bytes of files we actually read. */
  inspectedBytes: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  scannerVersion: string;
  policyVersion: string;
  riskScore: number;
  verdict: "allow" | "review" | "block";
  /** Exactly why this verdict was chosen. */
  rationale: string;
  findings: Finding[];
  dependencies: DependencyInfo;
  advisories: AdvisoryResult;
  /** Mandatory checks that did not complete. Non-empty forces at least REVIEW. */
  incompleteChecks: string[];
}

export interface FirewallEvent {
  id: string;
  timestamp: string;
  /** Sanitised, argument-array form. Never a raw shell string. */
  command: string[];
  /** Package coordinates this enforcement decision covered. */
  coordinates: string[];
  /** Scan ids backing the decision. */
  scanIds: string[];
  /** Security verdict from the scan. Distinct from enforcement action. */
  verdicts: ("allow" | "review" | "block" | "error")[];
  /** What the firewall did. BLOCKED_BEFORE_EXECUTION means npm never started. */
  action: "ALLOWED_INSTALL" | "BLOCKED_BEFORE_EXECUTION" | "REVIEW_HELD";
  /** Why it was held. */
  reason: string;
  /** True only when we actually spawned npm. */
  npmExecuted: boolean;
  exitCode: number | null;
}
