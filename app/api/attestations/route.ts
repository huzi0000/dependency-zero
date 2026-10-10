import { NextResponse } from "next/server";

import { collectAttestations } from "@/lib/network";
import { listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * List real attestations.
 *
 * Every row is backed by a stored attestation record. A row whose transaction
 * was never anchored reports `signature: null` and the honest reason, rather
 * than being dropped silently or being given an invented signature.
 */
export async function GET(request: Request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 20), 100);
  const scans = await listScans(1_000);
  const attestations = (await collectAttestations(scans)).slice(0, limit);

  return NextResponse.json({
    attestations: attestations.map((a) => ({
      id: a.id,
      packageName: a.packageName,
      version: a.version,
      verdict: a.verdict,
      signature: a.signature,
      status: a.status,
      mechanism: a.mechanism,
      slot: a.slot,
      commitmentHash: a.commitmentHash,
      reason: a.reason,
      createdAt: a.createdAt,
    })),
    counts: {
      total: attestations.length,
      confirmed: attestations.filter((a) => a.status === "confirmed").length,
      unanchored: attestations.filter((a) => !a.signature).length,
    },
  });
}