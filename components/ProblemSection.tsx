import { Bug, PackageX, SpellCheck, Waypoints } from "lucide-react";
import { ActionLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";

const THREATS = [
  {
    icon: PackageX,
    title: "Malicious Packages",
    body: "Hidden backdoors in popular libraries.",
  },
  {
    icon: SpellCheck,
    title: "Typosquatting",
    body: "Fake packages mimicking trusted names.",
  },
  {
    icon: Waypoints,
    title: "Supply Chain Attacks",
    body: "Compromised maintainers and build systems.",
  },
  {
    icon: Bug,
    title: "Runtime Exploits",
    body: "Malicious code executing at runtime.",
  },
];

export function ProblemSection() {
  return (
    <section id="product" aria-labelledby="problem-heading" className="pt-[80px] lg:pt-[100px]">
      <div className="page-shell">
        <div className="grid grid-cols-1 gap-x-10 gap-y-14 lg:grid-cols-[1.3fr_1fr] lg:items-start">
          {/* Copy ---------------------------------------------------------- */}
          <Reveal>
            <p className="eyebrow">The problem</p>
            <h2
              id="problem-heading"
              className="serif-display mt-7 text-[clamp(2.6rem,5.9vw,5.1rem)] text-ink"
            >
              Dependencies
              <br />
              are a hidden risk.
            </h2>
            <p className="mono-body mt-8 max-w-[58ch] text-[17px] leading-[1.62] text-ink-soft">
              AI agents and modern applications rely on thousands of open source
              packages. A single malicious or compromised dependency can lead to
              fund loss, data theft, or complete system takeover.
            </p>
            <div className="mt-10">
              <ActionLink href="/app/threats" variant="ink" size="md" arrow>
                See Real Threats
              </ActionLink>
            </div>
          </Reveal>

          {/* Cards --------------------------------------------------------- */}
          <ul className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:gap-3 lg:flex lg:flex-col lg:gap-2.5">
            {THREATS.map(({ icon: Icon, title, body }, index) => (
              <Reveal as="li" key={title} delay={index * 70}>
                <div className="flex h-full items-center gap-4 rounded-[8px] border border-line-soft bg-[#F4EAE3] py-[18px] pr-5 pl-[18px]">
                  <span className="flex size-[62px] shrink-0 items-center justify-center rounded-[8px] bg-[#FDF1EA]">
                    <Icon
                      aria-hidden="true"
                      strokeWidth={1.7}
                      className="size-[27px] text-blocked"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-sans text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                      {title}
                    </span>
                    <span className="mono-body mt-1.5 block text-[12.5px] leading-[1.4] text-label">
                      {body}
                    </span>
                  </span>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}