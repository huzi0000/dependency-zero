"use client";

import { CircleDashed, Cpu, FileCode2, Landmark, ShieldCheck } from "lucide-react";

/**
 * Four-step explanation of the intended network pipeline.
 *
 * This card describes the *designed* workflow, not current capability. The
 * reference shows live-looking chips there ("Valid Consensus", a sample
 * signature, three scanner avatars); those would be fabricated, so each chip
 * below reports the real state and is labelled as unavailable where it is.
 */
export function NetworkHowItWorks({ registeredNodes }: { registeredNodes: number }) {
  const steps = [
    {
      n: 1,
      icon: Cpu,
      title: "Local scanner roles",
      body: "Three analytical modules run under one operator identity. What they inspect is fixed by code, not by a registry.",
      chip: registeredNodes > 0 ? `${registeredNodes} registered` : "0 independent nodes",
      ready: registeredNodes > 0,
    },
    {
      n: 2,
      icon: FileCode2,
      title: "Package inspection",
      body: "The published tarball is checked for install scripts, obfuscation and integrity, alongside OSV advisories. Code is never executed.",
      chip: "Active",
      ready: true,
    },
    {
      n: 3,
      icon: ShieldCheck,
      title: "Signed findings & consensus",
      body: "Each role signs its findings with Ed25519. A deterministic policy returns ALLOW, REVIEW or BLOCK — there is no override flag.",
      chip: "Active",
      ready: true,
    },
    {
      n: 4,
      icon: Landmark,
      title: "Optional Solana Devnet anchor",
      body: "A commitment hash can be written to Solana Devnet so anyone can confirm the evidence has not changed. This is not malware detection.",
      chip: "Optional",
      ready: false,
    },
  ] as const;

  return (
    <section className="dz-card flex flex-col p-4" aria-labelledby="network-how-it-works">
      <h2 id="network-how-it-works" className="text-[16px] font-bold text-ink">
        How It Works
      </h2>
      <p className="mt-1 text-[12.5px] text-label">
        What this deployment actually does. Solana anchoring is optional and no
        independent scanner operators exist.
      </p>

      <ol className="mt-3.5 flex flex-col gap-2.5 lg:flex-row lg:items-stretch lg:gap-0">
        {steps.map((step, i) => (
          <li key={step.n} className="flex min-w-0 flex-1 items-center gap-2.5 lg:contents">
            <div className="flex min-w-0 flex-1 flex-col rounded-[8px] border border-line-soft bg-white p-3">
              <span
                aria-hidden="true"
                className="flex size-[22px] items-center justify-center rounded-full bg-ink text-[11.5px] font-bold text-surface"
              >
                {step.n}
              </span>
              {/* Titles are pinned to two lines and chips to a fixed height so
                  all four columns align despite different text lengths. */}
              <p className="mt-2.5 flex min-h-[2.4em] items-start text-[12.5px] leading-tight font-bold text-ink">
                {step.title}
              </p>
              <p className="mt-1.5 flex-1 text-[11.5px] leading-[1.5] text-label">
                {step.body}
              </p>
              <span
                className={`mono-body mt-3 inline-flex min-h-[26px] w-fit items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
                  step.ready
                    ? "bg-[#E6F3EC] text-[#155534]"
                    : "bg-[#F0EEE6] text-[#62645D]"
                }`}
              >
                {step.ready ? (
                  <ShieldCheck aria-hidden="true" strokeWidth={2} className="size-3" />
                ) : (
                  <CircleDashed aria-hidden="true" strokeWidth={2} className="size-3" />
                )}
                {step.chip}
              </span>
            </div>

            {/* Connector, as in the reference. Hidden on stacked layouts where
                it would push the cards off-centre. */}
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="hidden shrink-0 px-2 text-[15px] text-label lg:block"
              >
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
