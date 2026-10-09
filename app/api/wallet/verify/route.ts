import { NextResponse } from "next/server";

import { verifyWallet } from "@/lib/solana";

export const dynamic = "force-dynamic";

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return NextResponse.json({ ok: false, sol: null }, { status: 400 });
  }

  const result = await verifyWallet(address);
  return NextResponse.json({
    ok: result.ok,
    sol:
      result.lamports === null ? null : Math.round((result.lamports / LAMPORTS_PER_SOL) * 1e6) / 1e6,
  });
}
