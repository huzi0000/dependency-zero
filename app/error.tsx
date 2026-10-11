"use client";

import { useEffect } from "react";

import { ActionLink } from "@/components/ui/Button";

/**
 * Branded route-level error boundary.
 *
 * Without this, an unhandled throw during a demo renders Next.js's default
 * error page — raw framework branding in the middle of a product walkthrough.
 *
 * The error is logged to the console for the operator, but nothing about the
 * message, stack or environment is rendered to the visitor: the page states
 * only that something failed and offers a way forward.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Operator-facing only. Never surfaced in the rendered output.
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <main className="page-shell flex min-h-[70vh] flex-col items-center justify-center py-28 text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="mt-5 max-w-[18ch] font-sans text-[clamp(2rem,5vw,3.25rem)] font-bold leading-[1.02] tracking-[-0.03em] text-ink">
        This view could not load.
      </h1>
      <p className="mono-body mt-5 max-w-[46ch] text-[14.5px] leading-[1.65] text-ink-soft">
        The error has been logged on the server. Your scans, attestations and
        firewall records are stored separately and are unaffected.
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
        <ActionLink href="/app" variant="lime" size="md" arrow>
          Back to dashboard
        </ActionLink>
        <ActionLink href="/" variant="outline" size="md">
          Home
        </ActionLink>
      </div>
      <button
        type="button"
        onClick={reset}
        className="mono-body mt-8 text-[12.5px] text-label underline underline-offset-4 transition-colors hover:text-ink"
      >
        Try again
      </button>
    </main>
  );
}