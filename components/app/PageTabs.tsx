"use client";

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
 * Tabs are real buttons with `aria-selected` so arrow keys and screen readers
 * behave correctly without any custom key handling.
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
  return (
    <div role="tablist" aria-label={label} className={`dz-tabs ${className}`}>
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
            disabled={tab.disabled}
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
