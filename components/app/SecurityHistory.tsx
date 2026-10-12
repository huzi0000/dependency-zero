"use client";

import { useEffect, useState } from "react";

interface HistoryEntry {
  id: string;
  version: string;
  status: string;
  createdAt: string;
  threatCount: number;
  anchored: boolean;
  transactionSignature: string | null;
}

export function SecurityHistory({ packageName }: { packageName: string }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    fetch(`/api/history?package=${encodeURIComponent(packageName)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("History request failed");
        return response.json();
      })
      .then((data: { history: HistoryEntry[] }) => {
        setEntries(data.history);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [packageName]);

  if (loading) return <p>Loading security history...</p>;
  if (error) return <p>Unable to load security history.</p>;

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">Package Security History</h3>
        <p className="text-sm text-muted-foreground">
          Historical scan decisions and available Solana Devnet proofs.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm">No historical scans found.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-xl border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{packageName}@{entry.version}</p>
                  <p className="text-xs opacity-60">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-md border px-3 py-1 text-xs font-semibold">
                  {entry.status.toUpperCase()}
                </span>
              </div>

              <p className="text-sm opacity-70">
                {entry.threatCount} recorded finding(s)
                {" · "}
                {entry.anchored ? "Anchored on Solana Devnet" : "Not anchored"}
              </p>

              <div className="flex flex-wrap gap-4 text-sm">
                <a className="underline" href={`/scan/${entry.id}`}>
                  View report
                </a>
                {entry.anchored && entry.transactionSignature && (
                  <a
                    className="underline"
                    href={`https://explorer.solana.com/tx/${encodeURIComponent(entry.transactionSignature)}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View Solana proof
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
