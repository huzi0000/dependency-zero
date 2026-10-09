"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { WalletChip } from "@/components/app/WalletChip";
import { TimeAgo } from "@/components/app/TimeAgo";
import { StatusChip } from "@/components/app/verdict";
import type { ScanRecord } from "@/lib/types";

interface SearchResult {
  kind: "scan";
  scan: ScanRecord;
}

function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/scans?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { scans: ScanRecord[] };
          setResults(data.scans.slice(0, 6).map((scan) => ({ kind: "scan" as const, scan })));
        }
      } catch {
        /* aborted or offline — leave the list as-is */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(23,24,22,0.28)] px-4 pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="dz-scroll w-full max-w-xl overflow-hidden rounded-[12px] border border-line-soft bg-white shadow-[0_18px_48px_rgba(23,24,22,0.18)]"
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4">
          <Search aria-hidden="true" strokeWidth={1.8} className="size-4 shrink-0 text-label" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            placeholder="Package name, scan id, or tx signature…"
            className="h-12 w-full bg-transparent text-[14px] outline-none placeholder:text-label"
          />
          {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-label" /> : null}
        </div>

        <div className="dz-scroll max-h-[46vh] overflow-y-auto">
          {query.trim() === "" ? (
            <p className="mono-body px-4 py-6 text-center text-[12.5px] text-label">
              Search across recorded dependency scans.
            </p>
          ) : results.length === 0 ? (
            <p className="mono-body px-4 py-6 text-center text-[12.5px] text-label">
              No scans match “{query}”.
            </p>
          ) : (
            <ul>
              {results.map(({ scan }) => (
                <li key={scan.id}>
                  <Link
                    href={`/scan/${scan.id}`}
                    onClick={onClose}
                    className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0 hover:bg-[#F6F4EC]"
                  >
                    <span className="mono-body min-w-0 flex-1 truncate text-[13px] text-ink">
                      {scan.packageName}@{scan.version}
                    </span>
                    <StatusChip status={scan.status} />
                    <TimeAgo
                      iso={scan.createdAt}
                      className="mono-body shrink-0 text-[11.5px] text-label"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="dz-scroll flex h-16 items-center gap-3 border-b border-line-soft bg-surface/70 px-4 md:px-6">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[8px] border border-line-soft bg-white px-3.5 text-left transition-colors hover:border-line md:max-w-[420px]"
        >
          <Search aria-hidden="true" strokeWidth={1.8} className="size-4 shrink-0 text-label" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-label">
            Search dependencies, tx, or address…
          </span>
          <kbd className="mono-body hidden shrink-0 items-center gap-0.5 rounded border border-line-soft bg-[#F4F2EA] px-1.5 py-0.5 text-[10.5px] text-label sm:inline-flex">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Alerts appear only once a scanner node reports a finding. Until
              then this is a real "nothing to read" state, not a live feed. */}
          <span
            title="No unread alerts. Alerts appear when a scanner node reports a finding."
            className="hidden h-10 w-10 items-center justify-center rounded-[8px] border border-line-soft bg-white text-label sm:inline-flex"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="sr-only">No unread alerts</span>
          </span>
          <WalletChip />
        </div>
      </div>

      <SearchPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
