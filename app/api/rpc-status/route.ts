import { NextResponse } from "next/server";

import { getRpcStatus } from "@/lib/solana";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rpc: await getRpcStatus() });
}
