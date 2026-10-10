"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/app/EmptyState";
import { TimeAgo } from "@/components/app/TimeAgo";
import {
  HowItWorksCard,
  RealTimeAnalysisCard,
  ScanTabsCard,
  SupportedSourcesCard,
} from "@/components/app/ScanCards";
import { VERDICT_META, PENDING_CHIP } from "@/components/app/verdict";
import type { ScanRecord, ScanStatus } from "@/lib/types";

/** Real npm coordinates used as input examples. These are inputs, not results. */
const EXAMPLES = ["@ai-sdk/openai", "lodash@4.17.21", "express@4.18.2", "@solana/web3.js"];

function RowIcon({ status }: { status: ScanStatus }) {
  if (status === "allow") {
    return <ShieldCheck aria-hidden="true" strokeWidth={1.8} className="size-[17px] shrink-0 text-[#155534]" />;
  }
  if (status === "block") {
    return <XCircle aria-hidden="true" strokeWidth={1.8} className="size-[17px] shrink-0 text-[#8A2C23]" />;
  }
  if (status === "review") {
    return <AlertTriangle aria-hidden="true" strokeWidth={1.8} className="size-[17px] shrink-0 text-[#6B440B]" />;
  }
  if (status === "error") {
    return <ShieldAlert aria-hidden="true" strokeWidth={1.8} className="size-[17px] shrink-0 text-label" />;
  }
  return <CircleDashed aria-hidden="true" strokeWidth={1.8} className="size-[17px] shrink-0 text-label" />;
}

/** True while the scanner is still working on a record. */
function isInFlight(scan: ScanRecord): boolean {
  return scan.phase === "queued" || scan.phase === "scanning";
}

/**
 * Live status for a freshly submitted scan.
 *
 * Polls until the scanner reaches a terminal state, then stops. The banner names
 * the true lifecycle: QUEUED and SCANNING are distinct from COMPLETED, and an
 * ERROR is never presented as if it were a verdict.
 */
function ScanProgress({ scanId }: { scanId: string }) {
  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const data = (await res.json()) as { scan: ScanRecord };
      setScan(data.scan);
    } catch {
      setFailed(true);
    }
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      await load();
      if (cancelled) return;
      setScan((current) => {
        if (current && !isInFlight(current)) return current;
        timer = setTimeout(tick, 2000);
        return current;
      });
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  if (failed) {
    return (
      <div role="status" className="mt-4 rounded-[8px] border border-line bg-white px-4 py-3.5">
        <p className="text-[13px] text-ink">
          Scan record created. Live status is unavailable — open the Threat Report to
          see the stored result.
        </p>
      </div>
    );
  }
  if (!scan) return null;

  const done = !isInFlight(scan);
  const verdict = scan.verdict ?? (done && scan.status !== "error" ? scan.status : null);

  const tone = done
    ? verdict === "block"
      ? "border-[#E8B4AC] bg-[#FDF2F0]"
      : verdict === "review"
        ? "border-[#EBD3A4] bg-[#FDF7EA]"
        : verdict === "allow"
          ? "border-[#B9D9C6] bg-[#F1F8F4]"
          : "border-line bg-white"
    : "border-line bg-white";

  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-[8px] border px-4 py-3.5 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          {done ? (
            <RowIcon status={scan.status} />
          ) : (
            <Loader2 aria-hidden="true" strokeWidth={2} className="size-[17px] shrink-0 animate-spin text-label" />
          )}
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink">
              {done
                ? scan.status === "error"
                  ? "Scan failed"
                  : `Scan complete — ${verdict?.toUpperCase() ?? "UNKNOWN"}`
                : scan.phase === "scanning"
                  ? "Scanning package…"
                  : "Queued for scanning…"}
            </p>
            <p className="mono-body mt-1 text-[12px] leading-[1.6] text-label">
              {scan.status === "error"
                ? (scan.error ?? "The scanner could not complete this scan.")
                : done && scan.resolution
                  ? `${scan.resolution.resolvedName}@${scan.resolution.resolvedVersion} · risk ${scan.resolution.riskScore}/100 · ${scan.resolution.findings.length} finding(s)`
                  : done
                    ? "Analysis completed."
                    : "Resolving against the npm registry and inspecting the published artifact."}
            </p>
          </div>
        </div>
        <Link href={`/scan/${scan.id}`} className="dz-btn-primary shrink-0">
          View Threat Report
          <ArrowUpRight aria-hidden="true" strokeWidth={2} className="size-4" />
        </Link>
      </div>
    </div>
  );
}
function VerdictPill({ status }: { status: ScanStatus }) {
  if (status === "pending") {
    return (
      <span className={`mono-label inline-flex rounded px-2 py-[3px] text-[9.5px] ${PENDING_CHIP}`}>
        PENDING
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="mono-label inline-flex rounded bg-[#F0EEE6] px-2 py-[3px] text-[9.5px] text-label">
        ERROR
      </span>
    );
  }
  const meta = VERDICT_META[status];
  return (
    <span className={`mono-label inline-flex rounded px-2 py-[3px] text-[9.5px] ${meta.chip}`}>
      {meta.label}
    </span>
  );
}

/**
 * Split an npm coordinate into name and version.
 * Accepts "name@version", "name", and scoped "@scope/name@version".
 */
export function parseCoordinate(input: string): { name: string; version: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const at = trimmed.lastIndexOf("@");
  // A leading "@" means the package is scoped and has no version yet.
  if (at <= 0) return { name: trimmed, version: "latest" };

  const name = trimmed.slice(0, at);
  const version = trimmed.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}

export function ScanConsole({
  initial,
  examples,
}: {
  initial: ScanRecord[];
  /** Real coordinates already scanned on this deployment, most recent first. */
  examples: string[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState("");
  /** The scan record just created. Its presence drives the queued banner. */
  const [created, setCreated] = useState<ScanRecord | null>(null);

  async function submit(coordinate: string) {
    setError(null);
    setCreated(null);
    const parsed = parseCoordinate(coordinate);
    if (!parsed) {
      setError("Enter a package coordinate such as express@4.18.2.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageName: parsed.name, version: parsed.version }),
      });
      const data = (await res.json()) as { scan?: ScanRecord; error?: string };
      if (!res.ok || !data.scan) {
        setError(data.error ?? "The scan could not be recorded.");
        return;
      }
      // Stay on the page so the queued state is explicit. Pushing straight to
      // the report skipped the distinction between "record created" and
      // "analysis complete", which are very different things here.
      setCreated(data.scan);
    } catch {
      setError("Network error — the scan was not recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // `grid-cols-1` matters: Tailwind emits it as `minmax(0, 1fr)`, so the
    // track cannot be widened by the Recent Scans table's 720px min-width.
    // A bare `grid` sizes the track to max-content and pushes the whole page
    // wider than the viewport on phones.
    <div className="mx-auto min-w-0 max-w-[1280px]">
      {/* Rail is 460px (the reference is ~470px). At the previous 400px the
          "Real-time Analysis" hints wrapped labels onto a second line. */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        {/* ---------------------------------------------------------- left */}
        <div className="min-w-0">
          <h1 className="font-sans text-[34px] leading-[1.05] font-bold tracking-[-0.025em] text-ink">
            Scan Dependency
          </h1>
          <p className="mt-2.5 max-w-[60ch] text-[13.5px] leading-[1.55] text-label">
            Check any package before installation. Get real-time security analysis from
            our decentralized network.
          </p>

          <div className="mt-5">
            <ScanTabsCard
              onSubmit={submit}
              submitting={submitting}
              error={error}
              seed={seed}
              onValue={setSeed}
            />
          </div>

          {/* Live status for the scan just created. Distinct QUEUED /
              SCANNING / COMPLETED / ERROR states, and never a claim that
              analysis finished when only the record was written. */}
          {created ? <ScanProgress scanId={created.id} /> : null}


          {/* Example inputs. Seeded from real coordinates already recorded on
              this deployment so they are always packages that actually exist
              in scan history. */}
          <div className="mt-4">
            <p className="text-[12.5px] text-label">Try these examples:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setSeed(ex)}
                  className="dz-pill"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* ------------------------------------------------------ history */}
          <section className="dz-card mt-6 min-w-0 overflow-hidden" aria-labelledby="recent-scans">
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <h2 id="recent-scans" className="text-[15px] font-bold text-ink">
                Recent Scans
              </h2>
              {initial.length > 0 ? (
                <span className="mono-body text-[12px] text-label">{initial.length} total</span>
              ) : null}
            </div>

            {initial.length === 0 ? (
              <EmptyState
                title="No scans recorded yet"
                description="Submit a package above to create your first scan record. A verdict is attached only once a registered scanner node evaluates it."
              />
            ) : (
              /* `w-full` on the scroller matters: an auto-width block sizes to
                 the 720px min-width table and pushes the page wide. Pinning it
                 to the track width keeps the overflow inside this box. */
              <div className="dz-scroll w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="dz-overline border-b border-line-soft">
                      <th scope="col" className="px-4 py-2 font-normal">Package</th>
                      <th scope="col" className="px-4 py-2 font-normal">Version</th>
                      <th scope="col" className="px-4 py-2 font-normal">Verdict</th>
                      <th scope="col" className="px-4 py-2 font-normal">Risk Score</th>
                      <th scope="col" className="px-4 py-2 font-normal">Time</th>
                      <th scope="col" className="px-4 py-2"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {initial.slice(0, 12).map((scan) => (
                      <tr key={scan.id} className="dz-row group">
                        <td className="px-4 py-3">
                          <Link
                            href={`/scan/${scan.id}`}
                            className="flex items-center gap-2.5 text-ink"
                          >
                            <RowIcon status={scan.status} />
                            <span className="mono-body truncate text-[12.5px]">
                              {scan.packageName}
                            </span>
                          </Link>
                        </td>
                        <td className="mono-body px-4 py-3 text-[12.5px] text-label">
                          {scan.version}
                        </td>
                        <td className="px-4 py-3">
                          {isInFlight(scan) ? (
                            <span className="mono-label inline-flex items-center gap-1.5 rounded bg-[#EFEDE4] px-2 py-[3px] text-[9.5px] text-[#6A6C65]">
                              <Loader2 aria-hidden="true" strokeWidth={2.5} className="size-2.5 animate-spin" />
                              {scan.phase === "scanning" ? "SCANNING" : "QUEUED"}
                            </span>
                          ) : (
                            <VerdictPill status={scan.status} />
                          )}
                        </td>
                        {/* Real score from the scanner when there is one; an
                            honest dash while queued or for legacy records. */}
                        <td className="mono-body px-4 py-3 text-[12.5px] text-label">
                          {typeof scan.riskScore === "number" ? scan.riskScore : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <TimeAgo
                            iso={scan.createdAt}
                            className="mono-body text-[12px] whitespace-nowrap text-label"
                          />
                        </td>
                        {/* A visible label, not a bare chevron: the chevron alone
                            made the report destination ambiguous. This is a
                            sibling <Link>, not nested inside the package link,
                            so one click produces exactly one navigation. */}
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/scan/${scan.id}`}
                            className="dz-btn-ghost whitespace-nowrap"
                          >
                            View Report
                            <ChevronRight aria-hidden="true" strokeWidth={1.9} className="size-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* --------------------------------------------------------- right */}
        <aside className="flex min-w-0 flex-col gap-4">
          <HowItWorksCard />
          <SupportedSourcesCard />
          <RealTimeAnalysisCard />
        </aside>
      </div>
    </div>
  );
}
