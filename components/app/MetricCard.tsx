"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { NotEnoughData } from "@/components/app/EmptyState";

/** Compact sparkline drawn from real series data. Hidden when there is none. */
function Sparkline({
  values,
  tone,
}: {
  values: number[];
  tone: "ink" | "blocked";
}) {
  // A single bar carries no trend — only draw once there is a real shape.
  const nonZero = values.filter((v) => v > 0).length;
  if (nonZero < 3) return null;

  const w = 112;
  const h = 40;
  const max = Math.max(...values);
  const step = w / values.length;
  const barW = Math.max(1.5, step - 1.5);

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {values.map((v, i) => {
        // Zero buckets still show a 1px baseline tick so the axis reads.
        const barH = v > 0 ? Math.max(2, (v / max) * (h - 2)) : 1;
        return (
          <rect
            key={i}
            x={i * step}
            y={h - barH}
            width={barW}
            height={barH}
            rx={0.75}
            fill={
              v === 0
                ? "#E4E1D7"
                : tone === "blocked"
                  ? "#DF9A90"
                  : "#B6B2A4"
            }
          />
        );
      })}
    </svg>
  );
}

/**
 * Alert surface for text.
 *
 * The locked blocked red (#D94A3D) only reaches 3.76:1 on the tinted card
 * background, so error copy uses a darkened step of the same hue.
 */
export const ALERT_TEXT = "text-[#8A2C23]";

export function MetricCard({
  label,
  value,
  series,
  delta,
  tone = "ink",
  tooltip,
  suffix,
  footnote,
}: {
  label: string;
  value: number | null;
  series: number[];
  delta: number | null;
  tone?: "ink" | "blocked";
  tooltip?: string;
  suffix?: string;
  /** Replaces the default "No prior period" note when there is no delta. */
  footnote?: string;
}) {
  // Darkened steps of the locked hues: the base safe/blocked tokens are only
  // ~4.2-4.5:1 on white, which fails WCAG AA for 12.5px text.
  const deltaTone =
    delta === null ? "" : (delta as number) >= 0 ? "text-[#155534]" : "text-[#8A2C23]";
  const DeltaIcon = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={`dz-card flex flex-col justify-between gap-4 p-4 ${tone === "blocked" ? "dz-card-alert" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`dz-overline ${tone === "blocked" ? "text-[#8A2C23]" : ""}`}>
          {label}
        </p>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1 font-sans text-[30px] leading-none font-bold tracking-[-0.03em] text-ink">
            {value === null ? (
              <NotEnoughData>{tooltip ?? "Not enough data yet."}</NotEnoughData>
            ) : (
              <>
                {value.toLocaleString("en-US")}
                {suffix ? (
                  <span className="text-[19px] text-label">{suffix}</span>
                ) : null}
              </>
            )}
          </p>

          {delta === null ? (
            <p className="mono-body mt-2 text-[11.5px] text-label">
              {footnote ?? "No prior period"}
            </p>
          ) : (
            <p className={`mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium ${deltaTone}`}>
              <DeltaIcon aria-hidden="true" strokeWidth={2} className="size-3.5" />
              {Math.abs(delta)}%
            </p>
          )}
        </div>

        <Sparkline values={series} tone={tone} />
      </div>
    </div>
  );
}
