import { NextResponse } from "next/server";

import { listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Attestations are derived from resolved scans that carry a real on-chain
 * transaction signature. Scans that are still pending, or that were never
 * written on chain, are deliberately excluded — no signature is ever invented.
 */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const scans = await listScans(1_000);

  const attestations = scans
    .filter(
      (scan) =>
        scan.attestationSignature &&
        scan.status !== "pending" &&
        scan.status !== "error",
    )
    .slice(0, Math.min(limit, 100))
    .map((scan) => ({
      id: scan.id,
      packageName: scan.packageName,
      version: scan.version,
      verdict: scan.status,
      votes: scan.votes,
      signature: scan.attestationSignature as string,
      createdAt: scan.createdAt,
    }));

  return NextResponse.json({ attestations });
}
