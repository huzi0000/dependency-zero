import type { ScanStatus } from "@/lib/types";

/**
 * Verdict → presentation mapping, safe to import from Server Components.
 * Kept separate from the client-only dial components.
 */
export type DialTone = "blocked" | "review" | "allow" | "pending";

export const DIAL_TONE_STROKE: Record<DialTone, string> = {
  blocked: "#D94A3D",
  review: "#B87918",
  allow: "#21875A",
  pending: "#A3A49C",
};

export const DIAL_TONE_TEXT: Record<DialTone, string> = {
  blocked: "#8A2C23",
  review: "#6B440B",
  allow: "#155534",
  pending: "#62645D",
};

/** Maps a real scan status onto a dial tone. Never invents a verdict. */
export function toneForStatus(status: ScanStatus): DialTone {
  if (status === "block") return "blocked";
  if (status === "review") return "review";
  if (status === "allow") return "allow";
  return "pending";
}
