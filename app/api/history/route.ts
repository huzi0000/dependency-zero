import { NextResponse } from "next/server";
import { listScans, listAttestations } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const packageName = url.searchParams.get("package")?.trim();

  if (!packageName || packageName.length > 214) {
    return NextResponse.json(
      { error: "Valid package name required." },
      { status: 400 },
    );
  }

  const [scans, attestations] = await Promise.all([
    listScans(10000),
    listAttestations(10000),
  ]);

  const byScanId = new Map(attestations.map((a) => [a.scanId, a]));

  const history = scans
    .filter((scan) => scan.packageName.toLowerCase() === packageName.toLowerCase())
    .slice(0, 50)
    .map((scan) => {
      const proof = byScanId.get(scan.id);
      const anchor = proof?.attestation;

      return {
        id: scan.id,
        packageName: scan.packageName,
        version: scan.version,
        status: scan.status,
        createdAt: scan.createdAt,
        resolvedAt: scan.resolvedAt,
        threatCount: scan.findings.length,
        anchored: anchor?.confirmed === true,
        transactionSignature: anchor?.confirmed ? anchor.transactionSignature : null,
      };
    });

  return NextResponse.json(
    { packageName, history },
    { headers: { "Cache-Control": "no-store" } },
  );
}
