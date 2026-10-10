import "server-only";

import { attestationCommitment, memoPayload, scannersCommitment } from "./canonical.ts";
import { computeConsensus, CONSENSUS_POLICY_VERSION } from "./consensus.ts";
import {
  anchorCommitment,
  connect,
  idempotencyKeyFor,
  resolveSigner,
  verifyOnChain,
  type AttestationRecord,
  type ChainVerification,
} from "./solana.ts";
import {
  localRegistry,
  OPERATOR,
  REGISTRY_VERSION,
  registryCommitment,
  signAll,
} from "./registry.ts";
import { runAllScanners, type ScannerInput, type ScannerAssessment } from "./scanners.ts";
import { evaluatePolicy } from "@/lib/scanner/policy.ts";
import { buildProofBundle, type ProofBundle } from "./bundle.ts";
import type { Finding } from "@/lib/scanner/types.ts";
import type { TarballContents } from "@/lib/scanner/tarball.ts";

/**
 * End-to-end attestation pipeline.
 *
 * coordinate -> resolve -> inspect -> 3 scanners -> sign -> verify signatures ->
 * consensus -> commitment -> Solana Devnet anchoring.
 *
 * The attestation stage is deliberately SEPARATE from the security verdict. A
 * Solana RPC failure, a missing signer or a rate-limited faucet can never erase
 * or downgrade a completed security scan; it only leaves the attestation in an
 * honest non-confirmed state.
 */

export interface AttestationResult {
  scanId: string;
  assessments: ScannerAssessment[];
  signed: ReturnType<typeof signAll>;
  consensus: ReturnType<typeof computeConsensus>;
  commitment: string;
  scannersCommitment: string;
  registryCommitment: string;
  attestation: AttestationRecord;
  /** Populated when a live transaction was attempted. */
  chainVerification: ChainVerification | null;
  /** Why no live anchoring happened, when applicable. Never a silent skip. */
  anchorBlockedReason: string | null;
  bundle: ProofBundle;
}

/**
 * Run the three scanners, sign them, reach consensus and attempt anchoring.
 */
export async function runAttestation(params: {
  scanId: string;
  scannerInput: ScannerInput;
  /** Skip chain submission entirely (tests, offline demo). */
  offline?: boolean;
}): Promise<AttestationResult> {
  const input = params.scannerInput;

  // 1. Three analytical roles over the SAME artifact.
  const assessments = runAllScanners(input);

  // 2. Each signs its own assessment.
  const signed = signAll(assessments, params.scanId);

  // 3. Verify every signature and reach a deterministic consensus.
  //
  // The authoritative security verdict (computed by the policy engine over the
  // COMPLETE finding set) is passed in as a floor: consensus may only be equal
  // or more restrictive. Without this, a per-role partition could report ALLOW
  // for a package the security engine is holding as REVIEW.
  const registry = localRegistry();
  const securityVerdict = evaluatePolicy({
    findings: input.findings,
    incompleteChecks: input.incompleteChecks,
  }).verdict;
  const consensus = computeConsensus({
    results: signed,
    registry,
    expectedScanId: params.scanId,
    expectedArtifactSha256: input.artifactSha256,
    expectedName: input.resolvedName,
    expectedVersion: input.resolvedVersion,
    securityVerdict,
  });

  // 4. Deterministic commitment over everything above.
  const scannersCommitted = scannersCommitment(signed.map((s) => s.payload));
  const registryCommitted = registryCommitment(registry);
  const commitment = attestationCommitment({
    scanId: params.scanId,
    resolvedName: input.resolvedName,
    resolvedVersion: input.resolvedVersion,
    artifactSha256: input.artifactSha256,
    scannersCommitment: scannersCommitted,
    consensusResult: consensus.result,
    consensusPolicyVersion: consensus.policyVersion,
    registryVersion: REGISTRY_VERSION,
    registryCommitment: null,
    timestamp: input.timestamp,
  });

  const memo = memoPayload({
    commitment,
    scanId: params.scanId,
    artifactSha256: input.artifactSha256,
    consensus: consensus.result,
  });

  const idem = idempotencyKeyFor(params.scanId, commitment);

  // 5. Attempt a real Devnet anchor, unless explicitly offline.
  let attestation: AttestationRecord;
  let chainVerification: ChainVerification | null = null;
  let anchorBlockedReason: string | null = null;

  if (params.offline) {
    anchorBlockedReason = "Offline mode: chain submission was not attempted.";
    attestation = unanchored(params.scanId, input.artifactSha256, commitment, memo, idem, null);
  } else {
    const signer = resolveSigner();
    if (!signer.keypair) {
      anchorBlockedReason = signer.detail;
      attestation = unanchored(params.scanId, input.artifactSha256, commitment, memo, idem, signer.detail);
    } else {
      const connection = connect();
      attestation = await anchorCommitment({
        connection,
        signer: signer.keypair,
        memoText: memo,
        commitmentHash: commitment,
        scanId: params.scanId,
        artifactSha256: input.artifactSha256,
        idempotencyKey: idem,
      });
      // 6. Independently verify what we just submitted.
      if (attestation.transactionSignature) {
        chainVerification = await verifyOnChain({
          connection,
          signature: attestation.transactionSignature,
          expectedCommitment: commitment,
          expectedScanId: params.scanId,
        });
      }
      if (!attestation.confirmed) {
        anchorBlockedReason = attestation.error ?? "Anchoring did not confirm.";
      }
    }
  }

  const bundle = buildProofBundle({
    scanId: params.scanId,
    name: input.resolvedName,
    version: input.resolvedVersion,
    artifactSha256: input.artifactSha256,
    registry: input.registry,
    registryEntries: registry,
    registryCommitment: registryCommitted,
    registryVersion: REGISTRY_VERSION,
    operator: OPERATOR,
    scanners: signed,
    consensus,
    attestation,
    timestamp: input.timestamp,
  });

  return {
    scanId: params.scanId,
    assessments,
    signed,
    consensus,
    commitment,
    scannersCommitment: scannersCommitted,
    registryCommitment: registryCommitted,
    attestation,
    chainVerification,
    anchorBlockedReason,
    bundle,
  };
}

/** An honest NOT-anchored record. Never fabricates a signature. */
function unanchored(
  scanId: string,
  artifactSha256: string,
  commitment: string,
  memo: string,
  idempotencyKey: string,
  reason: string | null,
): AttestationRecord {
  return {
    schemaVersion: "d0-attestation/1",
    mechanism: "spl-memo",
    mechanismLabel: "Solana Devnet commitment anchored via Memo",
    cluster: "devnet",
    commitmentHash: commitment,
    scanId,
    artifactSha256,
    status: "not_started",
    transactionSignature: null,
    slot: null,
    confirmationStatus: null,
    blockTime: null,
    explorerUrl: null,
    submittedAt: null,
    confirmedAt: null,
    confirmed: false,
    error: reason,
    memoData: memo,
    memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    idempotencyKey,
  };
}

export { CONSENSUS_POLICY_VERSION };
export type { Finding, TarballContents, ProofBundle };
