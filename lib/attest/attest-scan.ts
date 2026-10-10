import "server-only";

import { runAttestation } from "@/lib/attest/pipeline";
import type { ScannerInput } from "@/lib/attest/scanners.ts";
import { saveAttestation } from "@/lib/store-core";
import type { ScanResolution } from "@/lib/scanner/types.ts";
import type { TarballContents } from "@/lib/scanner/tarball.ts";
import { safeFetch } from "@/lib/scanner/http.ts";
import { TARBALL_MAX_BYTES, TARBALL_TIMEOUT_MS, verifyIntegrity } from "@/lib/scanner/registry.ts";
import { attestationCommitment as computeAttCommitment, scannersCommitment } from "@/lib/attest/canonical.ts";

/**
 * Attestation stage of the scan pipeline.
 *
 * Runs AFTER the security verdict is already persisted, so nothing here can
 * destroy or downgrade a completed scan. Failures are recorded as honest
 * non-attested state; they are never silently swallowed and never presented as
 * success.
 *
 * Solana is an ADDITIONAL trust layer, not a prerequisite for the security
 * verdict. If Devnet is unreachable the scan still carries its real findings and
 * verdict, and the attestation simply reads NOT_ATTESTED.
 */
export async function attestScan(params: {
  scanId: string;
  resolution: ScanResolution;
  contents: TarballContents;
  integrityVerified: boolean;
  integrityNote: string | null;
  /** Skip chain submission (tests, offline runs). */
  offline?: boolean;
}): Promise<void> {
  const r = params.resolution;

  const input: ScannerInput = {
    scanId: params.scanId,
    resolvedName: r.resolvedName,
    resolvedVersion: r.resolvedVersion,
    artifactSha256: r.artifactSha256,
    findings: r.findings,
    advisories: r.advisories,
    dependencies: r.dependencies,
    contents: params.contents,
    registry: r.registry,
    integrityVerified: params.integrityVerified,
    integrityNote: params.integrityNote,
    incompleteChecks: r.incompleteChecks,
    timestamp: Date.parse(r.completedAt),
  };

  try {
    const result = await runAttestation({
      scanId: params.scanId,
      scannerInput: input,
      offline: params.offline,
    });

    await saveAttestation({
      scanId: params.scanId,
      bundle: result.bundle,
      attestation: result.attestation,
      consensus: result.consensus,
      verification: result.chainVerification
        ? {
            status: result.chainVerification.status,
            checkedAt: new Date().toISOString(),
            anchoredCommitment: result.chainVerification.anchoredCommitment,
            slot: result.chainVerification.slot,
            error: result.chainVerification.error,
          }
        : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // The security scan is already persisted and unaffected. Record the
    // attestation failure honestly so the UI can say why.
    await saveAttestation({
      scanId: params.scanId,
      bundle: {
        bundleSchema: "d0-proof-bundle/1.0.0",
        attestationSchema: "d0-attestation/1",
        generatedAt: new Date().toISOString(),
        scan: {
          id: params.scanId,
          name: r.resolvedName,
          version: r.resolvedVersion,
          artifactSha256: r.artifactSha256,
          registry: r.registry,
        },
        registry: {
          version: 0,
          commitment: "",
          entries: [],
          storage: "off-chain local registry, anchored by commitment",
          onChainProgramDeployed: false,
          operator: "local-operator (single machine)",
        },
        scanners: [],
        consensus: {
          verified: false,
          result: "review",
          quorumRequired: 3,
          quorumMet: 0,
          policyVersion: "unknown",
          votes: [],
          rejected: [],
          unavailableRoles: ["static_lifecycle", "dependency_advisory", "artifact_integrity"],
          rationale: "Attestation stage did not complete.",
          blockOverride: false,
        },
        attestation: {
          schemaVersion: "d0-attestation/1",
          mechanism: "spl-memo",
          mechanismLabel: "Solana Devnet commitment anchored via Memo",
          cluster: "devnet",
          commitmentHash: computeAttCommitment({
            scanId: params.scanId,
            resolvedName: r.resolvedName,
            resolvedVersion: r.resolvedVersion,
            artifactSha256: r.artifactSha256,
            scannersCommitment: scannersCommitment([]),
            consensusResult: "review",
            consensusPolicyVersion: "unknown",
            registryVersion: 0,
            registryCommitment: null,
            timestamp: Date.parse(r.completedAt),
          }),
          scanId: params.scanId,
          artifactSha256: r.artifactSha256,
          status: "failed",
          transactionSignature: null,
          slot: null,
          confirmationStatus: null,
          blockTime: null,
          explorerUrl: null,
          submittedAt: null,
          confirmedAt: null,
          confirmed: false,
          error: `Attestation error: ${(err as Error).message}`,
          memoData: null,
          memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
          idempotencyKey: params.scanId,
        },
        commitment: "",
        memoData: "",
        expectedMemoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        cluster: "devnet",
        trustModel: {
          independentOperators: false,
          note: "Attestation did not complete; no operator independence is claimed.",
        },
      },
      attestation: {
        schemaVersion: "d0-attestation/1",
        mechanism: "spl-memo",
        mechanismLabel: "Solana Devnet commitment anchored via Memo",
        cluster: "devnet",
        commitmentHash: "",
        scanId: params.scanId,
        artifactSha256: r.artifactSha256,
        status: "failed",
        transactionSignature: null,
        slot: null,
        confirmationStatus: null,
        blockTime: null,
        explorerUrl: null,
        submittedAt: null,
        confirmedAt: null,
        confirmed: false,
        error: `Attestation error: ${(err as Error).message}`,
        memoData: null,
        memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        idempotencyKey: params.scanId,
      },
      consensus: {
        verified: false,
        result: "review",
        quorumRequired: 3,
        quorumMet: 0,
        policyVersion: "unknown",
        votes: [],
        rejected: [],
        unavailableRoles: ["static_lifecycle", "dependency_advisory", "artifact_integrity"],
        rationale: "Attestation stage did not complete.",
        blockOverride: false,
      },
      verification: null,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }
}

export { safeFetch, TARBALL_MAX_BYTES, TARBALL_TIMEOUT_MS, verifyIntegrity };
