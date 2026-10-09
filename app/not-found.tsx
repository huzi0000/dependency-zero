import Link from "next/link";
import { ActionLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="page-shell flex min-h-[70vh] flex-col items-center justify-center py-28 text-center">
      <p className="eyebrow">404 — not found</p>
      <h1 className="serif-display mt-7 text-[clamp(2.6rem,7vw,5rem)] text-ink">
        This route is not
        <br />
        intercepted yet.
      </h1>
      <p className="mono-body mt-7 max-w-[46ch] text-[16px] leading-[1.65] text-ink-soft">
        Dependency Zero only guards what it can resolve. Head back to the landing
        page to explore the network.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3.5">
        <ActionLink href="/" variant="ink" size="md" arrow>
          Back Home
        </ActionLink>
        <Link
          href="/#network"
          className="inline-flex h-[58px] items-center rounded-[7px] border border-line bg-surface px-6 text-[15px] font-medium text-ink transition-colors duration-200 hover:border-ink"
        >
          Explore Network
        </Link>
      </div>
    </main>
  );
}