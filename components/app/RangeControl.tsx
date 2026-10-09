"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { TIME_RANGES, type TimeRange } from "@/lib/types";

/** Time range control. Switching re-fetches real aggregates from the server. */
export function RangeControl({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div
      role="group"
      aria-label="Time range"
      data-pending={pending ? "true" : undefined}
      className="dz-segment"
    >
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          data-active={value === range}
          aria-pressed={value === range}
          onClick={() => {
            onChange(range);
            // Keep the URL shareable so a filtered view can be linked.
            start(() => router.replace(`?range=${range}`, { scroll: false }));
          }}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
