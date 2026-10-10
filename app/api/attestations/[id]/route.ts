import { NextResponse } from "next/server";

import { getAttestation } from "@/lib/store";
import { verifyOnChain, connect } from "@/lib/attest/solana";

export const dynamic = "force-dynamic";

/**
 * Independent attestation verification for one scan.
 *
 * Recomputes the commitment from the stored evidence, then asks Solana Devnet
 * whether the recorded transaction really exists, succeeded, used the expected
 * Memo program and carries the same commitment.
 *
 * VERIFIED is returned only when BOTH the local recomputation and the chain
 * check pass. A signature string alone never yields VERIFIED.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stored = await getAttestation(id);

  if (!stored) {
    return NextResponse.json(
      {
        status: "NOT_ATTESTED",
        reason: "This scan predates attestation, or its attestation did not complete.",
        scanId: id,
      },
      { status: 200 },
    );
  }

  const { bundle, attestation } = stored;

  // Recompute from the bundle's own contents.
  const { verifyBundleOffline } = await import("@/lib/attest/bundle");
  const offline = verifyBundleOffline(bundle);

  if (!offline.ok) {
    return NextResponse.json({
      status: "FAILED",
      scanId: id,
      offlineChecks: offline.checks,
      reason: "Stored evidence failed offline verification (tampered or inconsistent).",
    });
  }

  if (!attestation.transactionSignature) {
    return NextResponse.json({
      status: "NOT_ATTESTED",
      scanId: id,
      commitment: bundle.commitment,
      reason:
        attestation.error ??
        "No transaction signature was recorded, so nothing is anchored on Solana Devnet.",
      offlineChecks: offline.checks,
    });
  }

  const chain = await verifyOnChain({
    connection: connect(),
    signature: attestation.transactionSignature,
    expectedCommitment: bundle.commitment,
    expectedScanId: bundle.scan.id,
  });

  return NextResponse.json({
    status: chain.status,
    scanId: id,
    package: `${bundle.scan.name}@${bundle.scan.version}`,
    artifactSha256: bundle.scan.artifactSha256,
    commitment: bundle.commitment,
    recomputedCommitment: offline.recomputedCommitment,
    mechanism: attestation.mechanismLabel,
    cluster: chain.cluster,
    signature: chain.signature,
    anchoredCommitment: chain.anchoredCommitment,
    memoProgramId: chain.memoProgramId,
    slot: chain.slot,
    blockTime: chain.blockTime,
    explorerUrl: chain.explorerUrl,
    commitmentMatches: chain.commitmentMatches,
    offlineChecks: offline.checks,
    consensus: {
      verified: bundle.consensus.verified,
      result: bundle.consensus.result,
      quorumMet: `${bundle.consensus.quorumMet}/${bundle.consensus.quorumRequired}`,
      policyVersion: bundle.consensus.policyVersion,
    },
    error: chain.error,
  });
}
