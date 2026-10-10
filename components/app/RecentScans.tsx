import Link from "next/link";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, XCircle } from "lucide-react";

import { EmptyState } from "@/components/app/EmptyState";
import { TimeAgo } from "@/components/app/TimeAgo";
import { StatusChip } from "@/components/app/verdict";
import type { ScanRecord } from "@/lib/types";

/**
 * Darkened steps of the locked semantic hues. The base safe / warn / blocked
 * tokens are 3.6-4.5:1 on white, which is below WCAG AA even at 18px. The icons
 * are redundant with the adjacent text chip, but are still contrast-checked.
 */
const ICON_TONE = {
  allow: "text-[#155534]",
  review: "text-[#6B440B]",
  block: "text-[#8A2C23]",
} as const;

function VerdictIcon({ status }: { status: ScanRecord["status"] }) {
  const cls = "size-[18px] shrink-0";
  if (status === "allow") {
    return <CheckCircle2 aria-hidden="true" strokeWidth={2} className={`${cls} ${ICON_TONE.allow}`} />;
  }
  if (status === "block") {
    return <XCircle aria-hidden="true" strokeWidth={2} className={`${cls} ${ICON_TONE.block}`} />;
  }
  if (status === "review") {
    return <AlertTriangle aria-hidden="true" strokeWidth={2} className={`${cls} ${ICON_TONE.review}`} />;
  }
  if (status === "error") {
    return <AlertOctagon aria-hidden="true" strokeWidth={2} className={`${cls} text-label`} />;
  }
  return <CircleDashed aria-hidden="true" strokeWidth={2} className={`${cls} text-label`} />;
}

export function RecentScans({ scans }: { scans: ScanRecord[] }) {
  return (
    // `min-w-0` matters: the parent grid has no explicit base `grid-cols-1`, so
    // its implicit track sizes to max-content. Without this the card grows to
    // the widest row and pushes past the viewport, which clipped the
    // "View Report" label and stopped the package name truncating.
    <section className="dz-card flex h-full min-w-0 flex-col" aria-labelledby="recent-scans-heading">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2
          id="recent-scans-heading"
          className="font-sans text-[15px] font-bold text-ink"
        >
          Recent Scans
        </h2>
        {scans.length > 0 ? (
          <Link
            href="/scan"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-label transition-colors hover:text-ink"
          >
            View all
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>

      {scans.length === 0 ? (
        <EmptyState
          title="No scans recorded"
          description="Submit a dependency to start your scan history. Verdicts appear once a registered scanner node evaluates the package."
          action={{ label: "Scan a Dependency", href: "/scan" }}
        />
      ) : (
        <ul className="min-w-0">
          {scans.map((scan) => (
            <li key={scan.id} className="dz-row min-w-0">
              {/* One link per row, so a click can only ever navigate once. The
                  "View Report" label is a span inside it, not a nested anchor. */}
              <Link
                href={`/scan/${scan.id}`}
                className="group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-[#F6F4EC]"
              >
                <VerdictIcon status={scan.status} />
                <span className="mono-body min-w-0 flex-1 truncate text-[13px] text-ink">
                  {scan.packageName}@{scan.version}
                </span>
                <StatusChip status={scan.status} />
                <TimeAgo
                  iso={scan.createdAt}
                  className="mono-body w-[62px] shrink-0 text-right text-[11.5px] text-label"
                />
                {/* Chevron always; the text needs ~84px that a phone cannot
                    spare beside the chip and timestamp. The whole row stays
                    tappable, so the destination remains reachable either way. */}
                <span
                  className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium whitespace-nowrap text-label transition-colors group-hover:text-ink"
                >
                  <span className="hidden sm:inline">View Report</span>
                  <ChevronRight aria-hidden="true" strokeWidth={1.9} className="size-3.5" />
                  <span className="sr-only sm:hidden">View Report</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
