import { DashboardView } from "@/components/app/DashboardView";
import { computeMetrics } from "@/lib/aggregations";
import { listNodes, listScans } from "@/lib/store";
import { TIME_RANGES, type TimeRange } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = (Array.isArray(params.range) ? params.range[0] : params.range)?.toUpperCase();
  const range: TimeRange = TIME_RANGES.includes(raw as TimeRange) ? (raw as TimeRange) : "24H";

  const [metrics, scans, nodes] = await Promise.all([
    computeMetrics(range),
    listScans(6),
    listNodes(),
  ]);

  // Attestations are only what has genuinely been written on chain.
  const attestations = (await listScans(1_000))
    .filter((scan) => scan.attestationSignature && scan.status !== "pending" && scan.status !== "error")
    .slice(0, 6)
    .map((scan) => ({
      id: scan.id,
      packageName: scan.packageName,
      version: scan.version,
      verdict: scan.status,
      votes: scan.votes,
      signature: scan.attestationSignature as string,
      createdAt: scan.createdAt,
    }));

  return (
    <DashboardView
      initial={{ metrics, scans, nodes, attestations, range }}
    />
  );
}
