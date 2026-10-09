import { NextResponse } from "next/server";

import { createScan, listScans, searchScans } from "@/lib/store";

export const dynamic = "force-dynamic";

/** npm package names: lowercase, URL-safe, optionally scoped. */
const PACKAGE_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION_RE = /^[a-zA-Z0-9-][a-zA-Z0-9.+_-]*$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const limit = Number(url.searchParams.get("limit") ?? 50);

  if (q) {
    return NextResponse.json({ scans: await searchScans(q, Math.min(limit, 50)) });
  }
  return NextResponse.json({ scans: await listScans(Math.min(limit, 200)) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { packageName, version } = (body ?? {}) as {
    packageName?: unknown;
    version?: unknown;
  };

  if (typeof packageName !== "string" || typeof version !== "string") {
    return NextResponse.json(
      { error: "packageName and version are required." },
      { status: 400 },
    );
  }

  const name = packageName.trim().toLowerCase();
  const ver = version.trim();

  if (!PACKAGE_RE.test(name)) {
    return NextResponse.json({ error: "Not a valid npm package name." }, { status: 400 });
  }
  if (!VERSION_RE.test(ver)) {
    return NextResponse.json({ error: "Not a valid package version." }, { status: 400 });
  }

  const scan = await createScan({ packageName: name, version: ver });
  return NextResponse.json({ scan }, { status: 201 });
}
