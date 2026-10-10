"use client";

import { AlertTriangle, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import {
  DIAL_TONE_STROKE,
  DIAL_TONE_TEXT,
  toneForStatus,
  type DialTone,
} from "@/lib/verdict-tone";

const TONE: Record<DialTone, { stroke: string; text: string; Icon: typeof ShieldCheck }> = {
  blocked: { stroke: DIAL_TONE_STROKE.blocked, text: DIAL_TONE_TEXT.blocked, Icon: ShieldAlert },
  review: { stroke: DIAL_TONE_STROKE.review, text: DIAL_TONE_TEXT.review, Icon: AlertTriangle },
  allow: { stroke: DIAL_TONE_STROKE.allow, text: DIAL_TONE_TEXT.allow, Icon: ShieldCheck },
  pending: { stroke: DIAL_TONE_STROKE.pending, text: DIAL_TONE_TEXT.pending, Icon: ShieldQuestion },
};

export { toneForStatus };
export type { DialTone };

/**
 * Circular verdict dial.
 *
 * With no scanner engine there is no risk score, so the ring is drawn as a
 * neutral track with a dashed "unknown" arc rather than a fabricated fill.
 */
export function RiskDial({
  tone,
  score,
  size = 92,
}: {
  tone: DialTone;
  /** Null renders an honest "no score" state. */
  score: number | null;
  size?: number;
}) {
  const { stroke, text, Icon } = TONE[tone];
  const strokeWidth = 6;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const pct = hasScore ? Math.max(0, Math.min(100, score)) / 100 : 0;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        hasScore
          ? `Risk score ${score} out of 100`
          : `Risk score not yet available (${tone})`
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeOpacity={hasScore ? 0.18 : 0.14}
          strokeWidth={strokeWidth}
        />
        {hasScore ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
          />
        ) : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.5}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray="3 7"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center" style={{ color: text }}>
        <Icon aria-hidden="true" strokeWidth={1.6} className="size-[30px]" />
      </span>
    </div>
  );
}

/**
 * Scanner consensus donut.
 *
 * Segments are only drawn for verdicts that actually have votes; with no
 * scanner nodes registered the ring is an empty track plus a zero caption.
 */
export function ConsensusDonut({
  block,
  review,
  allow,
  size = 116,
}: {
  block: number;
  review: number;
  allow: number;
  size?: number;
}) {
  const total = block + review + allow;
  const strokeWidth = 13;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  const segments = [
    { value: block, color: "#D94A3D" },
    { value: review, color: "#B87918" },
    { value: allow, color: "#21875A" },
  ].filter((s) => s.value > 0);

  let offset = 0;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        total > 0
          ? `${total} scanner votes: ${block} block, ${review} review, ${allow} allow`
          : "No scanner votes recorded"
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#E6E3DA"
          strokeWidth={strokeWidth}
        />
        {total > 0
          ? segments.map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.color}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })
          : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-sans text-[21px] leading-none font-bold text-ink">{total}</span>
        <span className="mt-1 text-[10.5px] text-label">Nodes</span>
      </div>
    </div>
  );
}
