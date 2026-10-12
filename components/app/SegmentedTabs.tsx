"use client";

import { useState } from "react";

import { useTabBar } from "@/components/app/useTabBar";

/**
 * Segmented navigation matching the Network reference: a bordered, rounded
 * group where the active segment is a solid ink pill.
 *
 * Four segments ("Overview / Scanners / Attestations / Registry") total about
 * 350px. Inside the ~320px content column available at a 360px viewport the
 * last segment sat outside the visible area, which the recording read as a
 * cut-off tab. Compressing the padding below `sm` reduces that overflow; where
 * it still cannot fit, the group scrolls with a visible cue and working arrow
 * keys via `useTabBar`, instead of silently hiding a tab.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const bar = useTabBar(tabs, value, onChange);

  return (
    <div className="relative min-w-0 max-w-full">
      <div
        role="tablist"
        aria-label={label}
        ref={bar.ref}
        className={`dz-scroll flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-[9px] border border-line-soft bg-white p-[3px] ${
          bar.canScrollLeft ? "dz-tabs-lead" : ""
        } ${bar.canScrollRight ? "dz-tabs-trail" : ""}`}
      >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`dz-net-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`dz-net-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            ref={bar.register(tab.id)}
            onKeyDown={(e) => bar.onKeyDown(e, tab.id)}
            onClick={() => onChange(tab.id)}
            className={`h-9 shrink-0 rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors sm:h-[30px] sm:px-4 ${
              active
                ? "bg-ink text-surface"
                : "text-ink hover:bg-[#F1EFE8]"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
      </div>
      {bar.canScrollRight ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 dz-tabs-cue dz-tabs-cue-end"
        >
          <svg
            viewBox="0 0 10 16"
            className="h-full w-[10px] fill-none stroke-label"
            preserveAspectRatio="none"
          >
            <path
              d="M2 2 L8 8 L2 14"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

/** Panel wrapper paired with `SegmentedTabs`. */
export function SegmentedPanel({
  id,
  active,
  children,
  className = "",
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`dz-net-panel-${id}`}
      aria-labelledby={`dz-net-tab-${id}`}
      tabIndex={0}
      className={`outline-none ${className}`}
    >
      {children}
    </div>
  );
}

/** Local tab state so callers do not each reimplement it. */
export function useSegmentedTab<T extends string>(initial: T) {
  return useState<T>(initial);
}
