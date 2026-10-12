import Image from "next/image";
import { ActionLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { GlobeParallax } from "@/components/GlobeParallax";

/**
 * Real, checkable facts about this deployment.
 *
 * Previously four invented counters (420 active nodes, 18.4K attestations,
 * 2.1s average scan, 99.7% consensus). None was computed from anything. The
 * counts here are the ones that are actually true and verifiable: three local
 * analytical roles, zero independently registered nodes, Ed25519 signatures, and
 * Solana Devnet as the attestation cluster.
 */
const NETWORK_STATS = [
  { value: "3", label: "Local scanner roles" },
  { value: "0", label: "Independent nodes" },
  { value: "Ed25519", label: "Verdict signatures" },
  { value: "Devnet", label: "Attestation cluster" },
];

/** Thin outlined chip used to annotate the globe artwork. */
function Chip({
  value,
  label,
  className = "",
  align = "left",
}: {
  value: string;
  label: string;
  className?: string;
  align?: "left" | "right";
}) {
  const notch =
    align === "right"
      ? "polygon(0 0, 100% 0, 100% 78%, calc(100% - 11px) 100%, 0 100%)"
      : "polygon(0 0, 100% 0, 100% 100%, 11px 100%, 0 78%)";

  return (
    <div
      style={{ clipPath: notch }}
      className={`rule-dark p-px ${className}`}
    >
      <div
        style={{ clipPath: notch }}
        className="flex items-center gap-2 bg-void px-2.5 py-2 sm:gap-2.5 sm:px-3.5 sm:py-2.5"
      >
        <span
          aria-hidden="true"
          className="size-[5px] shrink-0 rounded-full bg-lime sm:size-[6px]"
        />
        <span className="flex flex-col">
          <span className="font-sans text-[15px] leading-none font-bold tracking-[-0.01em] text-[#F4F3EE] sm:text-[17px]">
            {value}
          </span>
          <span className="mono-label mt-1.5 text-[10.5px] leading-[1.45] tracking-[0.1em] text-[#9B9B92] sm:tracking-[0.16em]"
          >
            {label}
          </span>
        </span>
      </div>
    </div>
  );
}

export function GlobalNetwork() {
  return (
    <section
      id="network"
      aria-labelledby="network-heading"
      className="on-dark mt-[52px] bg-void lg:mt-[25px]"
    >
      <div className="page-shell py-10 lg:py-[40px]">
        <div className="grid grid-cols-1 items-center gap-y-14 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-0">
          {/* Globe --------------------------------------------------------- */}
          <Reveal className="order-2 lg:order-1 lg:col-span-7">
            {/*
             The globe is an ILLUSTRATION, not live telemetry — the section
             states "0 independent nodes" directly beneath it. The interaction
             is therefore deliberately restrained: a slow float plus a small
             pointer-driven shift that reads as depth, never as a rotating globe
             or a live node map. CSS transforms only, no library, no layout
             shift (the wrapper keeps its box), and `prefers-reduced-motion`
             collapses it to a static image.
           */}
            <GlobeParallax>
              <div className="globe-drift">
                <Image
                  src="/global-network-globe.png"
                  alt="Illustrative world map graphic. Dependency Zero has no geographically distributed scanner nodes."
                  width={1536}
                  height={1024}
                  loading="lazy"
                  decoding="async"
                  className="float-slow block w-full"
                />
              </div>
              <Chip
                value="3 roles"
                label="Local scanners"
                align="right"
                className="absolute top-[11%] left-[4%] sm:left-[6%]"
              />
              <Chip
                value="0"
                label="Independent nodes"
                align="right"
                className="absolute top-[53%] left-[4%] sm:left-[6%]"
              />
              <Chip
                value="Devnet"
                label="Anchor cluster"
                align="left"
                className="absolute top-[64%] left-[38%] sm:left-[62%]"
              />
            </GlobeParallax>
          </Reveal>

          {/* Copy ---------------------------------------------------------- */}
          <Reveal className="order-1 lg:order-2 lg:col-span-5" delay={90}>
            <p className="eyebrow">Signed security evidence</p>
            <h2
              id="network-heading"
              className="serif-display mt-5 text-[clamp(2.15rem,4.3vw,3.6rem)] tracking-[0.005em] italic text-[#F2F1EC]"
            >
              Signed evidence.
              <br />
              Anchored on Solana.
            </h2>
            <p className="mono-body mt-6 max-w-[44ch] text-[16px] leading-[1.68] text-[#B9B9B1]">
              Three local scanner roles sign package findings. Exportable proof
              bundles let anyone verify those signatures and match the evidence
              against a commitment recorded on Solana Devnet.
            </p>
            <div className="mt-8">
              <ActionLink href="/network" variant="onDark" size="md" arrow>
                Explore Network
              </ActionLink>
            </div>

            <hr className="mt-9 border-0 border-t border-void-line" />

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
              {NETWORK_STATS.map((stat) => (
                <div key={stat.label}>
                  <dt className="mono-label text-[10.5px] leading-[1.45] tracking-[0.1em] text-[#9B9B92]">
                    {stat.label}
                  </dt>
                  <dd className="mt-2 font-sans text-[27px] font-bold leading-none tracking-[-0.02em] text-[#F4F3EE]">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mono-body mt-4 text-[11px] text-[#8C8C84]">
              {"// simulated live telemetry · prototype values"}
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}