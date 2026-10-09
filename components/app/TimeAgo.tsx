"use client";

import { useEffect, useState } from "react";

import { relativeTime } from "@/components/app/verdict";

function absolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Live relative timestamp.
 *
 * Relative time depends on the current clock, which differs between the server
 * render and hydration. The server (and the first client paint) therefore shows
 * an absolute date, and the relative label is applied after mount — no hydration
 * mismatch and no invented value.
 */
export function TimeAgo({
  iso,
  className = "",
  suffix = "",
}: {
  iso: string;
  className?: string;
  suffix?: string;
}) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setLabel(relativeTime(iso));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {label ?? absolute(iso)}
      {label ? suffix : ""}
    </time>
  );
}
