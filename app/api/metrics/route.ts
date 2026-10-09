import { NextResponse } from "next/server";

import { computeMetrics } from "@/lib/aggregations";
import { TIME_RANGES, type TimeRange } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("range")?.toUpperCase();
  const range: TimeRange = TIME_RANGES.includes(raw as TimeRange)
    ? (raw as TimeRange)
    : "24H";

  return NextResponse.json({ metrics: await computeMetrics(range) });
}
