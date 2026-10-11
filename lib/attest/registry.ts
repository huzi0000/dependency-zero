import "server-only";

import { createHash } from "node:crypto";
import { registryCommitment as computeRegistryCommitment } from "./canonical.ts";

import {
  attestationCommitment,
  canonicalizeScannerResult,
  findingsCommitment,
  memoPayload,
  scannersCommitment,
  type ScannerResultPayload,
} from "./canonical.ts";
import { publicIdentity, signWithRole, allPublicIdentities } from "./identity.ts";
import type { ScannerAssessment } from "./scanners.ts";
import { SCANNER_ROLES, type ScannerRole } from "./canonical.ts";
import type { ConsensusResult, RegistryEntry, SignedScannerResult } from "./consensus.ts";

/**
 * Scanner identity registry.
 *
 * CRITICAL DISTINCTION, kept explicit throughout this codebase:
 *
 *   LOCAL TRUST  - these identities are configured on this machine and their
 *                  public keys are known. Trust is a local decision.
 *   ON-CHAIN     - an identity is "registered on-chain" only when a registry
 *                  commitment for it has actually been anchored to Solana
 *                  Devnet and can be verified. No on-chain registry PROGRAM is
 *                  deployed, because no Rust/Anchor toolchain is available in
 *                  this environment.
 *
 * Nothing here claims a deployed program or an on-chain registry account. The
 * registry is off-chain; anchoring is a verifiable commitment, not a registry
 * account.
 */

export const REGISTRY_VERSION = 1;

/** Operator label. Honest: one operator runs all three. */
export const OPERATOR = "local-operator (single machine)";

export function localRegistry(): RegistryEntry[] {
  return allPublicIdentities().map((id) => ({
    publicKeyHex: id.publicKeyHex,
    publicKeyDer: id.publicKeyDer,
    role: id.role,
    registeredAt: id.createdAt,
    registryVersion: REGISTRY_VERSION,
    revoked: false,
    operator: OPERATOR,
  }));
}

/**
 * Hash over the trusted scanner registry.
 *
 * The implementation lives in `canonical.ts` so the standalone verifier can
 * recompute it without importing this store-bound module. Output is unchanged.
 */
export function registryCommitment(registry: RegistryEntry[]): string {
  return computeRegistryCommitment(registry);
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

/** Convert an assessment into the exact payload its signer commits to. */
export function toPayload(
  assessment: ScannerAssessment,
  scanId: string,
): { payload: ScannerResultPayload; findingsCommitment: string } {
  const fc = findingsCommitment(
    assessment.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      confidence: f.confidence,
      kind: f.kind,
      title: f.title,
      evidenceFile: f.evidence[0]?.file ?? "",
      evidenceLine: f.evidence[0]?.line ?? null,
      evidenceSnippet: f.evidence[0]?.snippet ?? "",
    })),
  );

  return {
    findingsCommitment: fc,
    payload: {
      schemaVersion: "d0-attestation/1",
      domain: "DEPENDENCY-ZERO/ATTESTATION",
      scanId,
      resolvedName: assessment.resolvedName,
      resolvedVersion: assessment.resolvedVersion,
      artifactSha256: assessment.artifactSha256,
      scannerPublicKey: publicIdentity(assessment.role).publicKeyHex,
      scannerRole: assessment.role,
      scannerVersion: assessment.scannerVersion,
      policyVersion: assessment.policyVersion,
      findingsCommitment: fc,
      findingCount: assessment.findings.length,
      proposedVerdict: assessment.proposedVerdict,
      riskScore: assessment.riskScore,
      completionStatus: assessment.completionStatus,
      timestamp: assessment.timestamp,
    },
  };
}

/** Sign one assessment with its role's key. */
export function signAssessment(assessment: ScannerAssessment, scanId: string): SignedScannerResult {
  const { payload } = toPayload(assessment, scanId);
  return { payload, signature: signWithRole(assessment.role, canonicalizeScannerResult(payload)) };
}

/** Sign all three and return them, one per role. */
export function signAll(assessments: ScannerAssessment[], scanId: string): SignedScannerResult[] {
  return assessments.map((a) => signAssessment(a, scanId));
}

export { SCANNER_ROLES, attestationCommitment, scannersCommitment, memoPayload };
export type { ScannerRole };