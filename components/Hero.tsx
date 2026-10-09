"use client";

import { Play } from "lucide-react";
import { ActionButton, ActionLink } from "@/components/ui/Button";
import { TagCallout } from "@/components/ui/Callout";

const HERO_METRICS = [
  { value: "1.2M+", label: "Dependencies scanned" },
  { value: "18.4K", label: "Threats blocked" },
  { value: "420+", label: "Scanner nodes" },
  { value: "99.7%", label: "Accuracy rate" },
];

const HERO_STAGES = [
  {
    label: "Scan",
    detail: "Analyze dependency behavior in real-time.",
  },
  {
    label: "Verify",
    detail: "Consensus from independent nodes.",
  },
  {
    label: "Protect",
    detail: "On-chain attestation before execution.",
  },
];

export function Hero() {
  return (
    <section className="page-shell pt-5 lg:pt-8" aria-labelledby="hero-heading">
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]">
        {/* ---------------------------------------------------------------- */}
        {/* Copy column                                                      */}
        {/* ---------------------------------------------------------------- */}
        <div className="relative z-10">
          <p className="eyebrow">Security layer for autonomous agents</p>

          <h1 id="hero-heading" className="mt-6 lg:mt-7">
            <span className="block font-sans text-[clamp(3.25rem,9.4vw,8.5rem)] font-bold leading-[0.84] tracking-[-0.035em] text-ink">
              ZERO
              <br />
              TRUST.
            </span>
            <span className="mt-1 block font-serif text-[clamp(2rem,6.1vw,5.65rem)] italic leading-[1.05] tracking-[-0.01em] text-ink">
              Before Execution.
            </span>
          </h1>

          <p className="mono-body mt-7 max-w-[34ch] text-[17px] leading-[1.62] text-ink-soft">
            Real-time dependency security network for AI agents and developers on
            Solana.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3.5">
            <ActionLink href="/app" variant="lime" size="md" arrow>
              Launch App
            </ActionLink>
            <ActionButton variant="outline" size="md">
              <Play aria-hidden="true" strokeWidth={1.6} className="size-[17px]" />
              Watch Demo
            </ActionButton>
          </div>

          <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-7 lg:w-[748px] lg:flex-nowrap lg:gap-x-[70px]">
            {HERO_METRICS.map((metric) => (
              <div
                key={metric.label}
                className="flex flex-col-reverse gap-2.5"
              >
                <dt className="mono-label text-[11px] leading-none whitespace-nowrap text-label">
                  {metric.label}
                </dt>
                <dd className="font-sans text-[44px] leading-none tracking-[-0.03em] text-ink">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mono-body mt-4 text-[11px] tracking-[0.02em] text-label">
            {"// illustrative product signals · simulated values"}
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Visual column                                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="relative">
          {/* No opaque plate here: the video is blended straight onto the page
              bone so the supporting metrics can sit beside the artwork. */}
          <div className="relative overflow-hidden">
            <div className="relative aspect-[363/387] w-full">
              <video
                className="flat-art absolute inset-0 size-full object-cover object-[62%_50%] xl:object-[70%_50%]"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/hero-poster.jpg"
                aria-label="Dependency interception, scanner stack and trust layer"
                tabIndex={-1}
              >
                <source src="/hero-visuals.mp4" type="video/mp4" />
              </video>
            </div>
          </div>

          {/* Annotated over the artwork from XL up; stacked beneath it below. */}
          <ul className="mt-5 flex list-none flex-col gap-4
                         xl:absolute xl:inset-x-0 xl:top-0 xl:mt-0 xl:h-full">
            {HERO_STAGES.map((stage, index) => (
              <li
                key={stage.label}
                className={`xl:absolute xl:right-0 ${
                  index === 0
                    ? "xl:top-[5%]"
                    : index === 1
                    ? "xl:top-[39%]"
                    : "xl:top-[73%]"
                }`}
              >
                <TagCallout
                  label={stage.label}
                  detail={stage.detail}
                  className="w-[214px] max-w-full"
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}