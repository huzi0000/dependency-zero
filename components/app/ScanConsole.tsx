"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, ScanLine } from "lucide-react";

import { TimeAgo } from "@/components/app/TimeAgo";
import { StatusChip } from "@/components/app/verdict";
import type { ScanRecord } from "@/lib/types";
import Link from "next/link";

export function ScanConsole({ initial }: { initial: ScanRecord[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Accept "express@4.18.2" in a single field.
    let pkg = name.trim();
    let ver = version.trim();
    if (!ver && pkg.includes("@") && !pkg.startsWith("@")) {
      const idx = pkg.lastIndexOf("@");
      pkg = pkg.slice(0, idx);
      ver = pkg.slice(idx + 1);
    }

    if (!pkg || !ver) {
      setError("Provide a package name and version, e.g. express@4.18.2.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageName: pkg, version: ver }),
      });
      const data = (await res.json()) as { scan?: ScanRecord; error?: string };
      if (!res.ok || !data.scan) {
        setError(data.error ?? "Scan request failed.");
        return;
      }
      setName("");
      setVersion("");
      router.refresh();
    } catch {
      setError("Network error — the scan was not recorded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <h1 className="font-sans text-[30px] leading-none font-bold tracking-[-0.02em] text-ink">
        Scan
      </h1>
      <p className="mt-2 max-w-[62ch] text-[13.5px] text-label">
        Request a dependency scan. The request is recorded immediately; a verdict
        is attached only once a registered scanner node evaluates it.
      </p>

      <form onSubmit={submit} className="dz-card mt-5 p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="dz-overline">Package</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="express"
              autoComplete="off"
              spellCheck={false}
              className="mono-body mt-2 h-10 w-full rounded-[7px] border border-line-soft bg-white px-3 text-[13px] outline-none focus:border-line"
            />
          </label>
          <label className="block">
            <span className="dz-overline">Version</span>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="4.18.2"
              autoComplete="off"
              spellCheck={false}
              className="mono-body mt-2 h-10 w-full rounded-[7px] border border-line-soft bg-white px-3 text-[13px] outline-none focus:border-line"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[7px] bg-ink px-5 text-[13.5px] font-medium text-surface transition-colors hover:bg-ink-soft disabled:opacity-60"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ScanLine aria-hidden="true" strokeWidth={1.8} className="size-4" />
            )}
            Scan
          </button>
        </div>

        {error ? (
          <p role="alert" className="mono-body mt-3 text-[12px] text-[#8A2C23]">
            {error}
          </p>
        ) : null}

        <p className="mono-body mt-3 text-[11.5px] leading-[1.6] text-label">
          Scans are queued, not faked. Until a scanner node is registered the
          request stays <span className="text-ink">PENDING</span> rather than
          receiving an invented verdict.
        </p>
      </form>

      <section className="dz-card mt-4" aria-labelledby="scan-history">
        <h2 id="scan-history" className="px-4 pt-4 text-[15px] font-bold text-ink">
          Scan history
        </h2>

        {initial.length === 0 ? (
          <p className="mono-body px-4 py-10 text-center text-[12.5px] text-label">
            No scans yet — submit a package above to create your first record.
          </p>
        ) : (
          <ul className="dz-scroll mt-2 max-h-[520px] overflow-y-auto">
            {initial.map((scan) => (
              <li key={scan.id} className="dz-row">
                <Link
                  href={`/scan/${scan.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#F6F4EC]"
                >
                  <span className="mono-body min-w-0 flex-1 truncate text-[13px] text-ink">
                    {scan.packageName}@{scan.version}
                  </span>
                  <StatusChip status={scan.status} />
                  <TimeAgo
                    iso={scan.createdAt}
                    className="mono-body w-[70px] shrink-0 text-right text-[11.5px] text-label"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
