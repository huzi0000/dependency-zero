import { NextResponse } from "next/server";

import { kickQueue } from "@/lib/scanner/queue";
import { enqueueRescan, getScan } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scan = await getScan(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  // A client polling for status also advances the queue.
  kickQueue();

  return NextResponse.json({ scan });
}

/**
 * Rescan.
 *
 * Deliberately creates a NEW scan record rather than re-running the existing
 * one in place. Historical records are immutable evidence; rewriting one would
 * destroy the audit trail. The client receives the new id and navigates to it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = await getScan(id);
  if (!source) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const fresh = await enqueueRescan(id);
  if (!fresh) {
    return NextResponse.json({ error: "Could not queue a rescan." }, { status: 500 });
  }

  kickQueue();

  return NextResponse.json({ scan: fresh, source: source.id }, { status: 201 });
}
