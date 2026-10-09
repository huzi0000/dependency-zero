"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies a full signature to the clipboard with inline confirmation. */
export function CopySignatureButton({
  value,
  label = "Copy full transaction signature",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard blocked — the signature is selectable on this page.
        }
      }}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-label transition-colors hover:bg-[#F0EEE6] hover:text-ink"
    >
      {copied ? (
        <Check aria-hidden="true" strokeWidth={2} className="size-3.5 text-safe" />
      ) : (
        <Copy aria-hidden="true" strokeWidth={1.7} className="size-3.5" />
      )}
    </button>
  );
}
