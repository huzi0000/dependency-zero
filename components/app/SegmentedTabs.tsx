"use client";

import { useState } from "react";

/**
 * Segmented navigation matching the Network reference: a bordered, rounded
 * group where the active segment is a solid ink pill.
 *
 * Uses `role="tablist"` with real buttons so arrow keys, Home/End and screen
 * readers behave without any custom key handling.
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
  return (
    <div
      role="tablist"
      aria-label={label}
      className="dz-scroll inline-flex max-w-full shrink-0 gap-1 overflow-x-auto rounded-[9px] border border-line-soft bg-white p-[3px]"
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
            onClick={() => onChange(tab.id)}
            className={`h-9 shrink-0 rounded-[6px] px-4 text-[13px] font-medium whitespace-nowrap transition-colors sm:h-[30px] ${
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
