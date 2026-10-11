import { DashboardView } from "@/components/app/DashboardView";
import { computeMetrics } from "@/lib/aggregations";
import { collectAttestations } from "@/lib/network";
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

  const [metrics, scans, nodes, allScans] = await Promise.all([
    computeMetrics(range),
    listScans(6),
    listNodes(),
    listScans(1_000),
  ]);

  /**
   * Attestations come from the same collector the `/api/attestations` route
   * uses.
   *
   * This used to filter `scans` on `scan.attestationSignature`, a field the
   * active pipeline never populates — it is only written by `resolveScan`,
   * which no route calls. The result was a permanently empty table on first
   * paint, while the client-side fetch after a range change showed real rows.
   * The dashboard therefore contradicted itself depending on how it was loaded.
   *
   * Using the shared collector keeps the server render and the client refresh
   * derived from exactly the same records. Anchoring is optional, so
   * `signature` is genuinely null for most rows and is rendered as such.
   */
  const collected = await collectAttestations(allScans);
  const attestationTotal = collected.length;
  const attestations = collected.slice(0, 6).map((a) => ({
    id: a.id,
    packageName: a.packageName,
    version: a.version,
    verdict: a.verdict as "allow" | "review" | "block",
    // The route payload carries no vote count. Rendering `undefined` would be a
    // silent claim about evidence, so the table shows an em dash instead.
    votes: 0,
    signature: a.signature,
    createdAt: a.createdAt,
  }));

  return (
    <DashboardView
      initial={{ metrics, scans, nodes, attestations, attestationTotal, range }}
    />
  );
}