import "server-only";

import { listNodes, listScans } from "@/lib/store";
import type { Metrics, ScanRecord, TimeRange } from "@/lib/types";

const RANGE_MS: Record<TimeRange, number | null> = {
  "24H": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
  "30D": 30 * 24 * 60 * 60 * 1000,
  ALL: null,
};

/** Number of buckets in the activity chart for a range. */
export function bucketCount(range: TimeRange): number {
  switch (range) {
    case "24H":
      return 24;
    case "7D":
      return 7 * 4;
    case "30D":
      return 30;
    case "ALL":
      return 30;
  }
}

/** Width of the window a range displays, and of one bucket inside it. */
function windowFor(range: TimeRange, now: number): { start: number; step: number; buckets: number } {
  const span = RANGE_MS[range] ?? 30 * 24 * 60 * 60 * 1000;
  const buckets = bucketCount(range);
  return { start: now - span, step: span / buckets, buckets };
}

function inRange(record: ScanRecord, from: number | null): boolean {
  if (from === null) return true;
  return Date.parse(record.createdAt) >= from;
}

function isBlocked(scan: ScanRecord): boolean {
  return scan.status === "block";
}

/**
 * Accuracy is only reported when it is defensible: we need at least
 * MIN_ACCURACY_SAMPLES resolved scans. Below that the UI shows an em dash
 * rather than a fabricated percentage.
 */
const MIN_ACCURACY_SAMPLES = 30;

export async function computeMetrics(range: TimeRange): Promise<Metrics> {
  const [allScans, nodes] = await Promise.all([listScans(10_000), listNodes()]);
  const span = RANGE_MS[range];
  const from = span === null ? null : Date.now() - span;

  const current = allScans.filter((s) => inRange(s, from));
  const previous =
    span === null || from === null
      ? null
      : allScans.filter((s) => {
          const t = Date.parse(s.createdAt);
          return t >= from - span && t < from;
        });

  const resolved = current.filter((s) => s.status !== "pending" && s.status !== "error");
  const accurate = resolved.filter((s) => s.status === "allow").length;
  const networkAccuracy =
    resolved.length >= MIN_ACCURACY_SAMPLES
      ? Math.round((accurate / resolved.length) * 1000) / 10
      : null;

  // The series always spans the full window ending now, so bucket 0 is the
  // oldest slice and the last bucket is the current partial one. Anchoring to
  // "now" instead would push every recent scan into a negative index.
  const now = Date.now();
  const { start, step, buckets } = windowFor(range, now);

  const series = Array.from({ length: buckets }, () => ({
    dependenciesScanned: 0,
    threatsBlocked: 0,
  }));

  for (const scan of current) {
    const index = Math.floor((Date.parse(scan.createdAt) - start) / step);
    if (index < 0 || index >= buckets) continue;
    series[index].dependenciesScanned += 1;
    if (isBlocked(scan)) series[index].threatsBlocked += 1;
  }

  // Labels are rendered server-side so they cannot drift on hydration.
  const bucketStarts = Array.from({ length: buckets }, (_, i) =>
    new Date(start + i * step).toISOString(),
  );
  const bucketLabels = bucketStarts.map((iso, i) => {
    const d = new Date(iso);
    return range === "24H"
      ? `${String(d.getHours()).padStart(2, "0")}:00`
      : `${d.getDate()}/${d.getMonth() + 1}`;
  });

  return {
    range,
    dependenciesScanned: current.length,
    threatsBlocked: current.filter(isBlocked).length,
    activeNodes: nodes.length,
    networkAccuracy,
    networkAccuracySamples: resolved.length,
    previous: previous
      ? {
          dependenciesScanned: previous.length,
          threatsBlocked: previous.filter(isBlocked).length,
          activeNodes: nodes.length,
        }
      : null,
    series,
    bucketLabels,
    bucketStarts,
  };
}


