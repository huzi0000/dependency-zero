"use client";

import { useTabBar } from "@/components/app/useTabBar";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Optional count badge, e.g. "Threats (6)". */
  badge?: number | string;
  /** Disabled tabs render muted and are not selectable. */
  disabled?: boolean;
}

/**
 * Underline tab bar shared by the Scanner, Threat Report and Network pages.
 *
 * Horizontal scroll, arrow-key navigation, roving tabindex and scroll-into-
 * view for the selected tab all come from `useTabBar`; see that file for why
 * the bar previously hid its own scrollbar and ignored arrow keys.
 */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className = "",
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const bar = useTabBar(tabs, value, onChange);

  return (
    <div className="relative">
      <div
        role="tablist"
        aria-label={label}
        ref={bar.ref}
        className={`dz-tabs dz-scroll ${bar.canScrollLeft ? "dz-tabs-lead" : ""} ${
          bar.canScrollRight ? "dz-tabs-trail" : ""
        } ${className}`}
      >
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`dz-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`dz-tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              ref={bar.register(tab.id)}
              onKeyDown={(e) => bar.onKeyDown(e, tab.id)}
              onClick={() => !tab.disabled && onChange(tab.id)}
              className={`dz-tab ${tab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge !== 0 ? (
                <span className="mono-body ml-1.5 text-[12px] text-label">{tab.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* Edge cues. Plain 1px rules and a chevron rather than a fade, to keep
          the Bone & Ink surfaces flat — no gradients anywhere in this build. */}
      {bar.canScrollLeft ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 dz-tabs-cue" />
      ) : null}
      {bar.canScrollRight ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 dz-tabs-cue dz-tabs-cue-end"
        >
          <svg viewBox="0 0 10 16" className="h-full w-[10px] fill-none stroke-label" preserveAspectRatio="none">
            <path d="M2 2 L8 8 L2 14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

/** Panel wrapper matching a `PageTabs` tab. */
export function TabPanel({
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
      id={`dz-tabpanel-${id}`}
      aria-labelledby={`dz-tab-${id}`}
      tabIndex={0}
      className={`outline-none ${className}`}
    >
      {children}
    </div>
  );
}
