import { NextResponse } from "next/server";

import { getAttestation } from "@/lib/store";
import { prepareWalletAnchor } from "@/lib/attest/wallet-flow";
import { CONSENSUS_POLICY_VERSION } from "@/lib/attest/consensus";

export const dynamic = "force-dynamic";

/**
 * Prepare an unsigned Memo transaction for the user's wallet to sign.
 *
 * Returns base64 transaction bytes and NOTHING sensitive. The wallet sets the
 * fee payer and signs inside the user's own extension; the server never holds
 * or asks for a key.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stored = await getAttestation(id);

  if (!stored) {
    return NextResponse.json(
      { ok: false, error: "No attestation evidence exists for this scan." },
      { status: 404 },
    );
  }

  // Consensus must exist and be signed before anything is anchored.
  if (!stored.bundle.scanners.length) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This scan has no signed scanner results, so there is nothing to anchor. " +
          "Run a fresh scan.",
      },
      { status: 409 },
    );
  }

  const result = await prepareWalletAnchor(id, stored);

  if (!result.ok) {
    const status = result.alreadyConfirmed ? 409 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({
    ...result,
    consensusPolicyVersion: CONSENSUS_POLICY_VERSION,
    consensusResult: stored.consensus.result,
    consensusVerified: stored.consensus.verified,
    scannerCount: stored.bundle.scanners.length,
  });
}