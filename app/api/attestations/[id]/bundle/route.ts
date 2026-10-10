import { NextResponse } from "next/server";

import { getAttestation } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Export the versioned proof bundle for a scan.
 *
 * The bundle is what an independent party verifies with the standalone
 * `d0-verify` command. It contains only public data: public keys, signatures,
 * hashes and the on-chain reference. No private key, secret or environment
 * value is ever included.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stored = await getAttestation(id);

  if (!stored) {
    return NextResponse.json(
      { error: "No attestation exists for this scan." },
      { status: 404 },
    );
  }

  const b = stored.bundle;

  // Defence in depth: refuse to emit anything that looks like key material.
  const serialised = JSON.stringify(b);
  if (/privateKey|PRIVATE KEY|mnemonic|secretKey/i.test(serialised)) {
    return NextResponse.json(
      { error: "Refusing to export: bundle integrity check failed." },
      { status: 500 },
    );
  }

  return new NextResponse(serialised, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="d0-proof-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}
