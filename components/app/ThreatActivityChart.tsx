"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Metrics } from "@/lib/types";

const TONE = {
  safe: { fill: "#C6C2B6", label: "Safe" },
  blocked: { fill: "#E24E40", label: "Blocked" },
} as const;

/**
 * Clearance in px needed between two adjacent x-axis labels.
 *
 * Sized for the 11px label face below. Axis type was raised from 9px/9.5px
 * because the SVG scales with its viewBox: at a 320px viewport the chart
 * rendered at 0.907 scale, so a 9.5px label landed at ~8.6px on screen. The
 * spacing budget moved with the type so labels stay separated rather than
 * colliding as they widen.
 */
const LABEL_PX = 72;

/**
 * Stacked activity chart drawn from real scan buckets.
 *
 * Hand-built SVG so the bars match the reference exactly and no charting
 * dependency is required. Fully keyboard accessible via a focusable group with
 * per-bar descriptions.
 */
export function ThreatActivityChart({ metrics }: { metrics: Metrics }) {
  const [hover, setHover] = useState<number | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // X labels are thinned against the real rendered width, so they never
  // collide at narrow viewports where the SVG scales down.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setPlotWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const series = metrics.series;
  const totals = series.map((b) => b.dependenciesScanned);
  const max = Math.max(...totals, 0);
  // Round the axis up to a friendly step so the gridlines stay readable.
  const yStep = max <= 5 ? 1 : max <= 10 ? 2 : max <= 50 ? 10 : 50;
  const yMax = Math.max(yStep, Math.ceil(max / yStep) * yStep);
  const ticks: number[] = [];
  for (let t = 0; t <= yMax; t += yStep) ticks.push(t);

  // The viewBox tracks the measured pixel width so 1 SVG unit === 1 CSS pixel.
  // That keeps bar geometry, gridlines and text all at true scale — no
  // horizontal squash, and no text distortion from a non-uniform transform.
  const W = Math.max(280, plotWidth || 640);
  const H = 190;
  const padL = 30;
  const padR = 6;
  const padT = 6;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / Math.max(1, series.length);
  const barW = Math.max(2, Math.min(16, slot * 0.62));

  const hasData = totals.some((t) => t > 0);

  // With nothing hovered, report the most recent bucket that actually has
  // activity — the trailing bucket is usually still empty and would read as a
  // misleading "0 scanned".
  const lastActive = hasData ? series.reduce((acc, b, i) => (b.dependenciesScanned > 0 ? i : acc), 0) : 0;
  const active = hover ?? lastActive;

  // Adjacent shown labels sit `labelStride` buckets apart, so their centre-to-
  // centre gap is `labelStride * slot`. See `LABEL_PX` for why the budget is
  // 72px rather than the ~30px an 11px mono time label actually occupies.
  // As the chart narrows this naturally draws fewer labels.
  const labelStride = Math.max(1, Math.ceil(LABEL_PX / slot));

  return (
    <section className="dz-card flex h-full flex-col p-4" aria-labelledby={titleId}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="font-sans text-[15px] font-bold text-ink">
          Threat Activity
        </h2>
        <ul className="flex items-center gap-3">
          <li className="flex items-center gap-1.5 text-[11.5px] text-label">
            <span
              aria-hidden="true"
              className="size-[9px] rounded-[2px]"
              style={{ background: TONE.safe.fill }}
            />
            Safe
          </li>
          <li className="flex items-center gap-1.5 text-[11.5px] text-label">
            <span
              aria-hidden="true"
              className="size-[9px] rounded-[2px]"
              style={{ background: TONE.blocked.fill }}
            />
            Blocked
          </li>
        </ul>
      </div>

      {hasData ? (
        <div className="mt-3 flex-1" ref={plotRef}>
          {/* Readout for the hovered bucket, or the latest active one. */}
          <p className="mono-body mb-1.5 h-4 truncate text-[11px] text-label">
            {metrics.bucketLabels[active]} · {series[active].dependenciesScanned} scanned ·{" "}
            {series[active].threatsBlocked} blocked
          </p>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            role="img"
            aria-label={`Stacked bar chart of ${metrics.range.toLowerCase()} scan activity. ${metrics.dependenciesScanned} scanned, ${metrics.threatsBlocked} blocked.`}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => {
              const y = padT + plotH - (t / yMax) * plotH;
              return (
                <g key={t}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={y}
                    y2={y}
                    stroke="#E6E3DA"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={padL - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="11"
                    fill="#62645D"
                    fontFamily="var(--font-ibm-plex-mono)"
                  >
                    {t}
                  </text>
                </g>
              );
            })}

            {series.map((bucket, i) => {
              const x = padL + i * slot + (slot - barW) / 2;
              const safeH = ((bucket.dependenciesScanned - bucket.threatsBlocked) / yMax) * plotH;
              const blockedH = (bucket.threatsBlocked / yMax) * plotH;
              const base = padT + plotH;

              return (
                <g
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${metrics.bucketLabels[i] ?? i}: ${bucket.dependenciesScanned} scanned, ${bucket.threatsBlocked} blocked`}
                  className="outline-none"
                >
                  <rect
                    x={padL + i * slot}
                    y={padT}
                    width={slot}
                    height={plotH}
                    fill={hover === i ? "#F1EFE8" : "transparent"}
                  />
                  {safeH > 0 ? (
                    <rect
                      x={x}
                      y={base - safeH - blockedH}
                      width={barW}
                      height={safeH}
                      fill={TONE.safe.fill}
                    />
                  ) : null}
                  {blockedH > 0 ? (
                    <rect
                      x={x}
                      y={base - blockedH}
                      width={barW}
                      height={blockedH}
                      fill={TONE.blocked.fill}
                    />
                  ) : null}
                </g>
              );
            })}

            <line
              x1={padL}
              x2={W - padR}
              y1={padT + plotH}
              y2={padT + plotH}
              stroke="#D8D5CC"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />

            {(() => {
              // Build the list first so the first/last pair is always kept and
              // never lands adjacent to another label.
              const shown: number[] = [];
              for (let i = 0; i < series.length; i += labelStride) shown.push(i);
              const last = series.length - 1;
              if (shown[shown.length - 1] !== last) {
                // Drop the second-to-last label if the final one would crowd it.
                const tail = shown[shown.length - 1];
                if ((last - tail) * slot < LABEL_PX) shown.pop();
                shown.push(last);
              }
              // Drop any label identical to the one before it, so a repeated
              // value (e.g. two buckets landing on the same day) only shows once.
              const deduped = shown.filter(
                (i, n) => n === 0 || metrics.bucketLabels[i] !== metrics.bucketLabels[shown[n - 1]],
              );
              return deduped.map((i) => {
                const isFirst = i === 0;
                const isLast = i === last;
                const centre = padL + (i + 0.5) * slot;
                // Anchor the end labels inward so neither clips the viewBox.
                const anchor = isFirst ? "start" : isLast ? "end" : "middle";
                return (
                  <text
                    key={i}
                    x={anchor === "start" ? padL : anchor === "end" ? W - padR : centre}
                    y={padT + plotH + 12}
                    textAnchor={anchor}
                    fontSize="11"
                    fill="#62645D"
                    fontFamily="var(--font-ibm-plex-mono)"
                  >
                    {metrics.bucketLabels[i]}
                  </text>
                );
              });
            })()}
          </svg>

          {/* Time labels live in the SVG so they stay aligned with the bars. */}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <p className="text-[14px] font-semibold text-ink">No scan activity yet</p>
          <p className="mono-body mt-2 max-w-[40ch] text-[12.5px] leading-[1.6] text-label">
            Activity appears here once dependencies are scanned through
            Dependency Zero.
          </p>
        </div>
      )}
    </section>
  );
}
