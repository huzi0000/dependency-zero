import Image from "next/image";
import { Clock } from "lucide-react";
import { ActionButton, ActionLink } from "@/components/ui/Button";
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
              Join a growing ecosystem of developers, teams and AI builders
              securing their supply chain with Dependency Zero.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3.5">
              <ActionLink href="/app" variant="lime" size="md" arrow>
                Launch App
              </ActionLink>
              <ActionButton variant="outline" size="md">
                <Clock aria-hidden="true" strokeWidth={1.6} className="size-[17px]" />
                Read Docs
              </ActionButton>
            </div>
          </Reveal>

          {/* Platform artwork ------------------------------------------------ */}
          <Reveal className="lg:col-span-7" delay={80}>
            <div className="relative mx-auto w-[108%] max-w-none -translate-x-[5%] lg:max-w-[648px]">
              <Image
                src="/isometric-network-platform.png"
                alt="Isometric view of the Dependency Zero trust layer connecting agents, apps and the ecosystem"
                width={1536}
                height={1024}
                loading="lazy"
                decoding="async"
                className="float-slower block w-full"
              />

              <TickCallout tone="ink" className="absolute left-[2%] top-[1%]">
                Safer agents
              </TickCallout>
              <TickCallout tone="ink" className="absolute left-[60%] top-[1%]">
                Stronger apps
              </TickCallout>
              <TickCallout tone="ink" className="absolute left-[31%] top-[95%]">
                Trusted ecosystem
              </TickCallout>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}