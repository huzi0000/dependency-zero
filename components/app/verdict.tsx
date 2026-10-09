import type { ScanStatus, Verdict } from "@/lib/types";

/** Verdict → presentation. Kept in one place so every surface agrees. */
/**
 * Chip text colours are a darkened step of the locked safe / warn / blocked
 * hues. The base tokens sit at ~4.5:1 on pure white, which is too tight for
 * 9.5px uppercase mono; these clear 6.4:1 on their own tinted backgrounds.
 */
export const VERDICT_META: Record<
  Verdict,
  { label: string; chip: string; dot: string }
> = {
  allow: {
    label: "ALLOW",
    chip: "bg-[#E6F3EC] text-[#155534]",
    dot: "text-safe",
  },
  review: {
    label: "REVIEW",
    chip: "bg-[#FBF0DC] text-[#6B440B]",
    dot: "text-warn",
  },
  block: {
    label: "BLOCK",
    chip: "bg-[#FBE9E6] text-[#8A2C23]",
    dot: "text-blocked",
  },
};

export const PENDING_CHIP = "bg-[#EFEDE4] text-[#6A6C65]";

export function StatusChip({ status }: { status: ScanStatus }) {
  if (status === "pending") {
    return (
      <span
        className={`mono-label inline-flex items-center rounded px-2 py-1 text-[9.5px] ${PENDING_CHIP}`}
      >
        PENDING
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="mono-label inline-flex items-center rounded bg-[#F0EEE6] px-2 py-1 text-[9.5px] text-label">
        ERROR
      </span>
    );
  }
  const meta = VERDICT_META[status];
  return (
    <span
      className={`mono-label inline-flex items-center rounded px-2 py-1 text-[9.5px] ${meta.chip}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * Compact relative time.
 *
 * Timestamps are inherently live, so the rendered string can differ between
 * the server pass and hydration. Callers should render the result inside a
 * <span suppressHydrationWarning> to keep the markup valid.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function truncateSignature(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 4)}…${sig.slice(-4)}`;
}
