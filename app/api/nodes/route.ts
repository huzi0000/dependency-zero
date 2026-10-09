import { NextResponse } from "next/server";

import { listNodes } from "@/lib/store";
import { getRpcStatus } from "@/lib/solana";

export const dynamic = "force-dynamic";

export async function GET() {
  const [nodes, rpc] = await Promise.all([listNodes(), getRpcStatus()]);
  return NextResponse.json({ nodes, rpc });
}
