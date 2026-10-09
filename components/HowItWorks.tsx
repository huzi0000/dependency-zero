import { Fragment } from "react";
import { ArrowRight } from "lucide-react";
import { ActionLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import {
  ProtectDiagram,
  ScanDiagram,
  VerifyDiagram,
} from "@/components/icons/StepDiagrams";

type TerminalLine = { text: string; accent?: boolean };

const STEPS = [
  {
    number: "01",
    title: "SCAN",
    body: "Analyze dependency behavior in real-time.",
    terminal: [
      { text: "$ npm install lodash" },
      { text: "> scanning..." },
      { text: "> analyzing behavior..." },
    ] as TerminalLine[],
    bar: "18%",
    Diagram: ScanDiagram,
  },
  {
    number: "02",
    title: "VERIFY",
    body: "Reach consensus from independent nodes.",
    terminal: [
      { text: "Independent scanners" },
      { text: "Consensus: Verified" },
      { text: "Risk assessment: Complete", accent: true },
    ] as TerminalLine[],
    bar: "64%",
    Diagram: VerifyDiagram,
  },
  {
    number: "03",
    title: "PROTECT",
    body: "On-chain attestation before execution.",
    terminal: [
      { text: "Attestation: Verified" },
      { text: "Status: SAFE", accent: true },
      { text: "Network: Solana Devnet" },
    ] as TerminalLine[],
    bar: "82%",
    Diagram: ProtectDiagram,
  },
];

function StepCard({ step }: { step: (typeof STEPS)[number] }) {
  const { number, title, body, terminal, bar, Diagram } = step;

  return (
    <article className="relative flex h-full w-full flex-1 flex-col rounded-[8px] border border-line-soft bg-surface p-6 lg:min-h-[404px] lg:p-7">
      {/* Top: number + heading + description, diagram alongside ------------- */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="mono-body text-[15px] leading-none font-medium text-clay">
            {number}
          </p>
          <h3 className="mt-4 font-sans text-[21px] leading-none font-bold tracking-[-0.015em] text-ink">
            {title}
          </h3>
          <p className="mono-body mt-3.5 text-[12.5px] leading-[1.5] text-label">
            {body}
          </p>
        </div>

        <div className="pointer-events-none mt-1 h-[104px] w-[132px] shrink-0 sm:h-[118px] sm:w-[150px]">
          <Diagram />
        </div>
      </div>

      {/* Bottom: terminal / status panel ------------------------------------ */}
      <div className="mt-6 rounded-[6px] bg-[#F0ECE4] px-4 pt-4 pb-4 lg:mt-auto">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="mono-label text-[9px] text-faint">Console</span>
          <span className="mono-label text-[9px] text-faint">{"// ui example"}</span>
        </div>
        <ul className="space-y-[6px]">
          {terminal.map((line) => (
            <li
              key={line.text}
              className={`mono-body text-[11.5px] leading-[1.55] break-words ${
                line.accent ? "text-lime-ink" : "text-ink-soft"
              }`}
            >
              {line.text}
            </li>
          ))}
        </ul>
        <div className="mt-3.5 h-[5px] w-full overflow-hidden rounded-full bg-[#E2DDD1]">
          <span className="block h-full rounded-full bg-lime" style={{ width: bar }} />
        </div>
      </div>
    </article>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="pt-[64px] lg:pt-[30px]">
      <div className="page-shell">
        <div className="grid grid-cols-1 items-end gap-x-10 gap-y-8 lg:grid-cols-12">
          <Reveal className="lg:col-span-7">
            <p className="eyebrow">How it works</p>
            <h2
              id="how-heading"
              className="serif-display mt-5 text-[clamp(2.35rem,4.9vw,3.85rem)] italic text-ink"
            >
              Security before execution.
              <br />
              In three steps.
            </h2>
          </Reveal>

          <Reveal className="lg:col-span-5 lg:justify-self-end" delay={80}>
            <p className="mono-body max-w-[46ch] text-[15px] leading-[1.62] text-ink-soft">
              Every dependency is scanned, verified by independent nodes, and
              attested on-chain before it ever executes in your environment.
            </p>
            <div className="mt-6">
              <ActionLink href="#product" variant="outline" size="sm" arrow>
                Learn More
              </ActionLink>
            </div>
          </Reveal>
        </div>

        {/* Arrows live in their own 40px grid columns, which are exactly the
            old `gap-x-10` between cards. `justify-center` then puts each arrow
            at the true midpoint of the gap with clearance either side, and
            `display:none` below lg keeps them out of the stacked grid. */}
        <div
          role="list"
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-[42px] lg:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)] lg:gap-x-0"
        >
          {STEPS.map((step, index) => (
            <Fragment key={step.number}>
              <div role="listitem" className="flex">
                <Reveal as="div" delay={index * 90} className="flex w-full">
                  <StepCard step={step} />
                </Reveal>
              </div>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none hidden items-center justify-center text-ink lg:flex"
                >
                  <ArrowRight strokeWidth={1.6} className="size-[22px]" />
                </span>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}