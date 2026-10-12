import Image from "next/image";
import { Clock } from "lucide-react";
import { ActionLink } from "@/components/ui/Button";
import { TickCallout } from "@/components/ui/Callout";
import { Reveal } from "@/components/ui/Reveal";

export function FinalCTA() {
  return (
    <section aria-labelledby="cta-heading" className="pt-[72px] lg:pt-[80px]">
      <div className="page-shell">
        <div className="grid grid-cols-1 items-center gap-x-10 gap-y-16 lg:grid-cols-12">
          {/* Copy ---------------------------------------------------------- */}
          <Reveal className="lg:col-span-5">
            <p className="eyebrow">Built for the next generation</p>
            <h2
              id="cta-heading"
              className="serif-display mt-6 text-[clamp(2.5rem,5.1vw,3.9rem)] italic text-ink"
            >
              Secure the
              <br />
              foundation of
              <br />
              autonomous systems.
            </h2>
            <p className="mono-body mt-8 max-w-[47ch] text-[17px] leading-[1.62] text-ink-soft">
              Ship evidence you can hand to a reviewer: a signed proof bundle,
              an optional Solana Devnet anchor, and a firewall that holds the
              verdict before npm runs.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3.5">
              <ActionLink href="/app" variant="lime" size="md" arrow>
                Launch App
              </ActionLink>
              {/* Replaced the inert "Read Docs" button. There is no docs route;
                  this points at the verification surface that actually exists. */}
              <ActionLink href="/network" variant="outline" size="md" arrow>
                <Clock aria-hidden="true" strokeWidth={1.6} className="size-[17px]" />
                See verification
              </ActionLink>
            </div>
          </Reveal>

          {/* Platform artwork ------------------------------------------------ */}
          <Reveal className="lg:col-span-7" delay={80}>
            {/* The artwork used to be `w-[108%] -translate-x-[5%]` at every width. That
                deliberate bleed is fine on a wide page, but at phone width it
                pushed the container 8% past the viewport and dragged the
                absolutely-positioned tick labels with it: "Stronger apps" ended
                up with its right edge ~38px off-screen. The bleed is now
                desktop-only, and below `sm` the three labels are rendered as a
                wrapped legend attached under the artwork instead of pinned
                across it, which is also far more readable at that size. */}
            <div className="relative mx-auto w-full lg:w-[108%] lg:max-w-[648px] lg:-translate-x-[5%]">
              <Image
                src="/isometric-network-platform.png"
                alt="Isometric view of the Dependency Zero trust layer connecting agents, apps and the ecosystem"
                width={1536}
                height={1024}
                loading="lazy"
                decoding="async"
                className="float-slower block w-full"
              />

              <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 sm:hidden">
                <li><TickCallout tone="ink">Safer agents</TickCallout></li>
                <li><TickCallout tone="ink">Stronger apps</TickCallout></li>
                <li><TickCallout tone="ink">Verifiable evidence</TickCallout></li>
              </ul>

              {/* An absolutely-positioned layer is used rather than `hidden sm:inline-flex`
                on each callout. `TickCallout` always emits its own
                `inline-flex`, which wins the `display` cascade over a `hidden`
                utility on the same element regardless of class order — the
                desktop pins were therefore still rendering at phone width. */}
              <div className="pointer-events-none absolute inset-0 hidden sm:block">
                <TickCallout tone="ink" className="absolute left-[2%] top-[1%]">
                  Safer agents
                </TickCallout>
                <TickCallout tone="ink" className="absolute left-[60%] top-[1%]">
                  Stronger apps
                </TickCallout>
                <TickCallout tone="ink" className="absolute left-[31%] top-[95%]">
                  Verifiable evidence
                </TickCallout>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}