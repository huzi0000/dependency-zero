import Link from "next/link";
import { AlertTriangle, ScanLine } from "lucide-react";

/** Polished empty state used wherever real data is required but absent. */
export function EmptyState({
  title,
  description,
  icon: Icon = ScanLine,
  action,
}: {
  title: string;
  description: string;
  icon?: typeof ScanLine;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-[8px] border border-line-soft bg-[#F6F4ED]">
        <Icon aria-hidden="true" strokeWidth={1.6} className="size-5 text-label" />
      </span>
      <p className="mt-3.5 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mono-body mt-2 max-w-[42ch] text-[12.5px] leading-[1.6] text-label">
        {description}
      </p>
      {action ? (
        <Link
          href={action.href}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-[7px] bg-ink px-4 text-[13.5px] font-medium text-surface transition-colors hover:bg-ink-soft"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Explains a metric that cannot be computed honestly yet. */
export function NotEnoughData({ children }: { children: string }) {
  return (
    <span
      title={children}
      className="mono-body inline-flex cursor-help items-center gap-1.5 text-[12.5px] text-label"
    >
      <AlertTriangle aria-hidden="true" strokeWidth={1.7} className="size-3.5" />
      —
    </span>
  );
}
