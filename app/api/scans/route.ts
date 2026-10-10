import { NextResponse } from "next/server";

import { parseCoordinate, CoordinateError } from "@/lib/scanner/coordinate";
import { kickQueue } from "@/lib/scanner/queue";
import { createScan, listScans, searchScans } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const limit = Number(url.searchParams.get("limit") ?? 50);

  if (q) {
    return NextResponse.json({ scans: await searchScans(q, Math.min(limit, 50)) });
  }

  const scans = await listScans(Math.min(limit, 200));

  // Opportunistically make progress on any queued work, so a client that only
  // polls this endpoint still advances the queue.
  kickQueue();

  return NextResponse.json({ scans });
}

/**
 * Create a scan.
 *
 * The submitted string is parsed by the same strict coordinate parser the
 * scanner uses, so the API rejects the same specs the CLI rejects. Previously
 * this endpoint accepted a name and version separately; it still does, and they
 * are reassembled into a coordinate.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { packageName, version, coordinate } = (body ?? {}) as {
    packageName?: unknown;
    version?: unknown;
    coordinate?: unknown;
  };

  let requested: string;
  if (typeof coordinate === "string" && coordinate.trim()) {
    requested = coordinate.trim();
  } else if (typeof packageName === "string" && typeof version === "string") {
    requested = `${packageName.trim()}@${version.trim()}`;
  } else if (typeof packageName === "string") {
    requested = packageName.trim();
  } else {
    return NextResponse.json(
      { error: "A package coordinate is required, e.g. is-number@7.0.0." },
      { status: 400 },
    );
  }

  let coord;
  try {
    coord = parseCoordinate(requested);
  } catch (err) {
    if (err instanceof CoordinateError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid package coordinate." }, { status: 400 });
  }

  const scan = await createScan({
    packageName: coord.name,
    // "latest" is preserved so the report shows what was requested rather than
    // pretending the caller pinned a version.
    version: coord.version ?? "latest",
  });

  kickQueue();

  return NextResponse.json({ scan }, { status: 201 });
}
