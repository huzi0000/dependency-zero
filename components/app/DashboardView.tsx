"use client";

import { useEffect, useState } from "react";

import { AttestationsTable, NetworkStats } from "@/components/app/Attestations";
import { MetricCard } from "@/components/app/MetricCard";
import { NetworkOverview } from "@/components/app/NetworkOverview";
import { RangeControl } from "@/components/app/RangeControl";
import { RecentScans } from "@/components/app/RecentScans";
import { ThreatActivityChart } from "@/components/app/ThreatActivityChart";
import {
  percentChange,
  type Metrics,
  type ScanRecord,
  type ScannerNode,
  type TimeRange,
} from "@/lib/types";

type Attestation = {
  id: string;
  packageName: string;
  version: string;
  verdict: ScanRecord["status"];
  votes: number;
  signature: string;
  createdAt: string;
};

interface Payload {
  metrics: Metrics;
  scans: ScanRecord[];
  nodes: ScannerNode[];
  attestations: Attestation[];
  range: TimeRange;
}

export function DashboardView({ initial }: { initial: Payload }) {
  const [range, setRange] = useState<TimeRange>(initial.range);
  const [data, setData] = useState<Payload>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (range === initial.range) return;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [metrics, scans, attestations] = await Promise.all([
          fetch(`/api/metrics?range=${range}`, { signal: controller.signal }).then(
            (r) => r.json() as Promise<{ metrics: Metrics }>,
          ),
          fetch("/api/scans?limit=6", { signal: controller.signal }).then(
            (r) => r.json() as Promise<{ scans: ScanRecord[] }>,
          ),
          fetch("/api/attestations?limit=6", { signal: controller.signal }).then(
            (r) => r.json() as Promise<{ attestations: Attestation[] }>,
          ),
        ]);
        if (cancelled) return;
        setData({
          metrics: metrics.metrics,
          scans: scans.scans,
          nodes: data.nodes,
          attestations: attestations.attestations,
          range,
        });
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load dashboard data.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `data.nodes` is intentionally excluded: node count is not range-scoped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, initial.range]);

  const { metrics, scans, nodes, attestations } = data;
  const scannedSeries = metrics.series.map((b) => b.dependenciesScanned);
  const blockedSeries = metrics.series.map((b) => b.threatsBlocked);

  const scannedDelta = percentChange(
    metrics.dependenciesScanned,
    metrics.previous?.dependenciesScanned,
  );
  const blockedDelta = percentChange(
    metrics.threatsBlocked,
    metrics.previous?.threatsBlocked,
  );
  const nodeDelta = percentChange(metrics.activeNodes, metrics.previous?.activeNodes);
  // The attestation table is a windowed list, not a cumulative total, so it has
  // no defensible period-over-period delta yet.
  const attestationDelta = null;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-sans text-[30px] leading-none font-bold tracking-[-0.02em] text-ink">
            Dashboard
          </h1>
          <p className="mt-2 text-[13.5px] text-label">
            Real-time overview of dependency threats and network activity.
          </p>
        </div>
        <RangeControl value={range} onChange={setRange} />
      </div>

      {error ? (
        <p
          role="alert"
          className="dz-card-alert mono-body mt-5 rounded-[10px] border px-4 py-3 text-[12.5px] text-[#8A2C23]"
        >
          {error}
        </p>
      ) : null}

      <div
        aria-busy={loading || undefined}
        className={`mt-5 grid gap-3 transition-opacity sm:grid-cols-2 xl:grid-cols-4 ${
          loading ? "opacity-60" : "opacity-100"
        }`}
      >
        <MetricCard
          label="Dependencies Scanned"
          value={metrics.dependenciesScanned}
          series={scannedSeries}
          delta={scannedDelta}
        />
        <MetricCard
          label="Threats Blocked"
          value={metrics.threatsBlocked}
          series={blockedSeries}
          delta={blockedDelta}
          tone="blocked"
        />
        <MetricCard
          label="Active Nodes"
          value={metrics.activeNodes}
          series={[]}
          delta={nodeDelta}
        />
        <MetricCard
          label="Network Accuracy"
          value={metrics.networkAccuracy}
          suffix="%"
          series={[]}
          delta={null}
          footnote={
            metrics.networkAccuracy === null
              ? `${metrics.networkAccuracySamples} of 30 resolved scans needed`
              : `${metrics.networkAccuracySamples} resolved scans`
          }
          tooltip={`Network accuracy is the share of resolved scans returning ALLOW. It needs at least 30 resolved scans before it can be reported; ${metrics.networkAccuracySamples} so far.`}
        />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_1fr]">
        <ThreatActivityChart metrics={metrics} />
        <RecentScans scans={scans} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_1fr]">
        <NetworkOverview nodes={nodes} />
        <div className="dz-card flex flex-col p-4">
          <NetworkStats
            activeNodes={metrics.activeNodes}
            totalAttestations={attestations.length}
            consensusRate={null}
            nodeDelta={nodeDelta}
            attestationDelta={attestationDelta}
          />
          <p className="mono-body mt-3 text-[11px] leading-[1.5] text-label">
            Consensus rate is hidden until a real multi-node voting process runs
            on this deployment.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <AttestationsTable attestations={attestations} />
      </div>
    </div>
  );
}
