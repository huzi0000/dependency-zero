/**
 * Deterministic verified consensus over signed scanner results.
 *
 * This is the core safety logic. Every rule below exists because a naive
 * majority vote over security assessments is dangerous:
 *
 *  - A BLOCK vote must never be outvoted into ALLOW by two unrelated clean
 *    assessments. Two scanners that did not detect the threat is not evidence
 *    that the first scanner was wrong.
 *  - A missing or unavailable scanner is NOT an approving vote. Quorum counts
 *    only valid, signature-verified, non-duplicate results.
 *  - Any cryptographic failure prevents verified consensus entirely.
 *  - Unknown, revoked or unregistered identities are rejected, not trusted.
 *  - Conflicting scanner versions are surfaced as REVIEW rather than merged.
 *
 * TRUST DISCLOSURE: three signatures from one operator prove internal
 * consistency and tamper-evidence. They do NOT provide independent
 * verification or Byzantine fault tolerance, and this module never claims they
 * do.
 */

import type { ScannerRole, ScannerResultPayload } from "./canonical.ts";
import { SCANNER_ROLES } from "./canonical.ts";
import { verifySignature } from "./verify-signature.ts";
import { canonicalizeScannerResult } from "./canonical.ts";

/** Bump on any change to quorum or verdict rules. Part of the commitment. */
export const CONSENSUS_POLICY_VERSION = "d0-consensus/1.0.0";

/** Quorum: all three roles must report for a fully verified consensus. */
export const REQUIRED_QUORUM = 3;

export type Verdict = "allow" | "review" | "block";

export interface SignedScannerResult {
  payload: ScannerResultPayload;
  signature: string;
}

export interface RegistryEntry {
  publicKeyHex: string;
  publicKeyDer: string;
  role: ScannerRole;
  registeredAt: string;
  registryVersion: number;
  revoked: boolean;
  operator: string;
}

export type RejectionReason =
  | "unknown_identity"
  | "revoked_identity"
  | "role_mismatch"
  | "bad_signature"
  | "duplicate_identity"
  | "scan_id_mismatch"
  | "artifact_mismatch"
  | "package_mismatch"
  | "schema_mismatch"
  | "scanner_version_conflict"
  | "incomplete_result";

export interface ValidVote {
  role: ScannerRole;
  publicKeyHex: string;
  verdict: Verdict;
  riskScore: number;
  rationale: string;
  operator: string;
}

export interface RejectedVote {
  publicKeyHex: string;
  role: string;
  reason: RejectionReason;
  detail: string;
}

export interface ConsensusResult {
  /** True only when quorum was met and every vote cryptographically valid. */
  verified: boolean;
  result: Verdict;
  quorumRequired: number;
  quorumMet: number;
  policyVersion: string;
  votes: ValidVote[];
  rejected: RejectedVote[];
  /** Roles that did not report. Explicitly "unavailable", never approving. */
  unavailableRoles: ScannerRole[];
  rationale: string;
  /** True when at least one BLOCK vote stood. */
  blockOverride: boolean;
}

export interface ConsensusInput {
  results: SignedScannerResult[];
  registry: RegistryEntry[];
  expectedScanId: string;
  expectedArtifactSha256: string;
  expectedName: string;
  expectedVersion: string;
  /**
   * The authoritative security verdict, from the policy engine run over the
   * COMPLETE finding set.
   *
   * This clamp is the most important safety rule in the module. The three
   * scanners each evaluate a partition of the findings, and a partition can
   * legitimately score below a threshold that the whole set crosses: a package
   * with two medium advisories (Scanner B, risk 18) plus a low-severity source
   * finding (Scanner A, risk 9) reaches the review threshold of 25 only when
   * combined. Without this clamp, quorum would report ALLOW for a package the
   * security engine is holding as REVIEW — the exact "evidence outvoted away"
   * failure this module exists to prevent.
   *
   * Consensus may therefore be equal to or MORE restrictive than the security
   * verdict, but never less.
   */
  securityVerdict?: Verdict;
}

const RANK: Record<Verdict, number> = { allow: 0, review: 1, block: 2 };

export function computeConsensus(input: ConsensusInput): ConsensusResult {
  const rejected: RejectedVote[] = [];
  const valid: ValidVote[] = [];
  const seen = new Set<string>();
  const versions = new Set<string>();

  const byKey = new Map(input.registry.map((e) => [e.publicKeyHex, e]));
  const voteByRole = new Map<ScannerRole, { vote: ValidVote; payload: ScannerResultPayload }>();

  for (const r of input.results) {
    const p = r.payload;
    const key = p.scannerPublicKey;

    const reject = (reason: RejectionReason, detail: string) => {
      rejected.push({ publicKeyHex: key, role: p.scannerRole, reason, detail });
    };

    // 1. Identity must exist in the registry.
    const entry = byKey.get(key);
    if (!entry) {
      reject("unknown_identity", `Public key is not in the scanner registry.`);
      continue;
    }
    // 2. Revoked identities never count.
    if (entry.revoked) {
      reject("revoked_identity", `Identity was revoked (registry v${entry.registryVersion}).`);
      continue;
    }
    // 3. The registered role must match the claimed role.
    if (entry.role !== p.scannerRole) {
      reject("role_mismatch", `Registered as ${entry.role}, claimed ${p.scannerRole}.`);
      continue;
    }
    // 4. Signature must verify over the canonical bytes.
    if (!verifySignature(canonicalizeScannerResult(p), r.signature, entry.publicKeyDer)) {
      reject("bad_signature", "Ed25519 signature did not verify against the registered public key.");
      continue;
    }
    // 5. Must be about this scan.
    if (p.scanId !== input.expectedScanId) {
      reject("scan_id_mismatch", `Bound to scan ${p.scanId}, expected ${input.expectedScanId}.`);
      continue;
    }
    // 6. Must be about this exact artifact. This is what stops a valid result
    //    for one package being replayed onto another.
    if (p.artifactSha256 !== input.expectedArtifactSha256) {
      reject("artifact_mismatch", `Bound to artifact ${p.artifactSha256}, expected ${input.expectedArtifactSha256}.`);
      continue;
    }
    if (p.resolvedName !== input.expectedName || p.resolvedVersion !== input.expectedVersion) {
      reject("package_mismatch", `Bound to ${p.resolvedName}@${p.resolvedVersion}.`);
      continue;
    }
    // 7. One vote per identity.
    if (seen.has(key)) {
      reject("duplicate_identity", "Identity submitted more than one vote.");
      continue;
    }
    // 8. Schema must match, or bytes mean different things.
    if (p.schemaVersion !== input.results[0]?.payload.schemaVersion) {
      reject("schema_mismatch", "Signed schema version differs from the first result.");
      continue;
    }
    // 9. A failed scanner is not an approving vote.
    if (p.completionStatus !== "completed") {
      reject("incomplete_result", "Scanner did not complete.");
      continue;
    }
    // 10. Two results for the same role would double-count one perspective.
    if (voteByRole.has(p.scannerRole)) {
      reject("duplicate_identity", `Role ${p.scannerRole} already reported.`);
      continue;
    }

    seen.add(key);
    versions.add(p.scannerVersion);
    const vote: ValidVote = {
      role: p.scannerRole,
      publicKeyHex: key,
      verdict: p.proposedVerdict,
      riskScore: p.riskScore,
      rationale: "",
      operator: entry.operator,
    };
    voteByRole.set(p.scannerRole, { vote, payload: p });
    valid.push(vote);
  }

  const unavailableRoles = SCANNER_ROLES.filter((r) => !voteByRole.has(r));
  const quorumMet = valid.length;
  const versionConflict = versions.size > 1;

  let result: Verdict;
  const reasons: string[] = [];

  const hasBlock = valid.some((v) => v.verdict === "block");
  const hasReview = valid.some((v) => v.verdict === "review");
  const quorumMetFully = quorumMet >= REQUIRED_QUORUM;

  if (!quorumMetFully) {
    // Fail toward caution: an under-attended scan is REVIEW, never ALLOW.
    result = hasBlock ? "block" : "review";
    reasons.push(
      `Quorum not met (${quorumMet}/${REQUIRED_QUORUM} valid results). ` +
        `Unavailable roles: ${unavailableRoles.join(", ") || "none"}. Unattended scans cannot be ALLOW.`,
    );
  } else if (rejected.length > 0) {
    result = hasBlock ? "block" : "review";
    reasons.push(
      `${rejected.length} submitted result(s) failed validation ` +
        `(${[...new Set(rejected.map((r) => r.reason))].join(", ")}). Cryptographic failure prevents a clean consensus.`,
    );
  } else if (hasBlock) {
    // The safety rule: a BLOCK is never outvoted into ALLOW.
    result = "block";
    reasons.push(
      `${valid.filter((v) => v.verdict === "block").length} scanner(s) returned BLOCK. ` +
        `A block verdict is not outvoted by clean assessments from other roles.`,
    );
  } else if (versionConflict) {
    result = "review";
    reasons.push(`Scanners reported differing versions (${[...versions].join(", ")}); results were not merged blindly.`);
  } else if (hasReview) {
    result = "review";
    reasons.push(`${valid.filter((v) => v.verdict === "review").length} scanner(s) returned REVIEW.`);
  } else {
    result = "allow";
    reasons.push("All three scanner roles independently returned ALLOW with valid signatures.");
  }

  const verified =
    quorumMetFully &&
    rejected.length === 0 &&
    unavailableRoles.length === 0 &&
    !versionConflict;

  if (!verified && result === "allow") {
    // Defensive: verified consensus is required before ALLOW can stand.
    result = "review";
    reasons.push("Downgraded to REVIEW because verified consensus was not achieved.");
  }

  // The safety clamp: a partitioned vote may never be more permissive than the
  // authoritative verdict computed over the complete finding set.
  const sv = input.securityVerdict;
  if (sv && RANK[sv] > RANK[result]) {
    reasons.push(
      `Consensus clamped from ${result} to ${sv}: the security policy over the complete ` +
        `finding set returned ${sv}, and a per-role vote must never be more permissive ` +
        `than the authoritative result.`,
    );
    result = sv;
  }

  return {
    verified,
    result,
    quorumRequired: REQUIRED_QUORUM,
    quorumMet,
    policyVersion: CONSENSUS_POLICY_VERSION,
    votes: valid,
    rejected,
    unavailableRoles,
    rationale: reasons.join(" "),
    blockOverride: hasBlock && valid.length > 1,
  };
}
