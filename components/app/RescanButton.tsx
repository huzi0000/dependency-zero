"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Rescan control.
 *
 * Deliberately creates a NEW scan rather than mutating the existing record.
 * Historical records are evidence; rewriting one would destroy the audit trail.
 *
 * Shown mainly for legacy records written before the real scanner existed,
 * which cannot be resumed safely and will never complete on their own.
 */
export function RescanButton({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rescan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scans/${scanId}`, { method: "POST" });
      const data = (await res.json()) as { scan?: { id: string }; error?: string };
      if (!res.ok || !data.scan) {
        setError(data.error ?? "Could not start a rescan.");
        return;
      }
      router.push(`/scan/${data.scan.id}`);
      router.refresh();
    } catch {
      setError("Network error — the rescan was not queued.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={rescan}
        disabled={busy}
        className="dz-btn-ghost"
        aria-label="Rescan this package"
      >
        <RefreshCw
          aria-hidden="true"
          strokeWidth={1.9}
          className={`size-3.5 ${busy ? "animate-spin" : ""}`}
        />
        {busy ? "Queueing…" : "Rescan this package"}
      </button>
      {error ? (
        <p role="alert" className="mono-body text-[11px] text-[#8A2C23]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
