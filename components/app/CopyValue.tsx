"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Inline copy-to-clipboard for mono values (signatures, ids, keys).
 *
 * A client component because it owns clipboard state; the surrounding panel
 * primitives stay in the server layer.
 */
export function CopyValue({
  value,
  display,
  label,
}: {
  value: string;
  /** Shortened text to render. Defaults to `value`. Copying always uses `value`
   *  in full, so a truncated display never silently copies a fragment. */
  display?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const shown = display ?? value;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="mono-body truncate">{shown}</span>
      <button
        type="button"
        title={label ?? `Copy ${value}`}
        aria-label={label ?? `Copy ${value}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — the value stays selectable */
          }
        }}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-label transition-colors hover:bg-[#F0EEE6] hover:text-ink"
      >
        {copied ? (
          <Check aria-hidden="true" strokeWidth={2} className="size-3.5 text-[#155534]" />
        ) : (
          <Copy aria-hidden="true" strokeWidth={1.7} className="size-3.5" />
        )}
      </button>
    </span>
  );
}
