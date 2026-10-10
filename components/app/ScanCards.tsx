"use client";

import { Box, Globe, ShieldCheck, FileCode2, Terminal } from "lucide-react";

import { PageTabs, TabPanel, type TabItem } from "@/components/app/PageTabs";
import { useWalletRequirement } from "@/components/app/WalletRequirement";
import { useEffect, useState } from "react";

type Tab = "single" | "batch" | "pkgjson" | "cli";

const TABS: TabItem<Tab>[] = [
  { id: "single", label: "Single Scan" },
  { id: "batch", label: "Batch Scan", disabled: true },
  { id: "pkgjson", label: "From package.json", disabled: true },
  { id: "cli", label: "CLI Command", disabled: true },
];

/** Right-rail informational panels from the Scanner reference. */
function HowItWorksCard() {
  const steps = [
    {
      icon: Box,
      title: "Scan",
      body: "Analyze package code, scripts and dependencies in real-time.",
    },
    {
      icon: Globe,
      title: "Verify",
      body: "Get consensus from independent scanners on Solana.",
    },
    {
      icon: ShieldCheck,
      title: "Protect",
      body: "Block malicious packages before execution.",
    },
  ];

  return (
    <section className="dz-card p-4">
      <h2 className="text-[15px] font-bold text-ink">How it works</h2>
      <ol className="mt-4 flex flex-col">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#F1EFE8]">
                <step.icon aria-hidden="true" strokeWidth={1.6} className="size-[18px] text-ink" />
              </span>
              {i < steps.length - 1 ? (
                <span aria-hidden="true" className="my-1 w-px flex-1 bg-lime-deep" />
              ) : null}
            </div>
            <div className={i < steps.length - 1 ? "pb-5" : "pb-0"}>
              <p className="text-[13.5px] font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-[12.5px] leading-[1.55] text-label">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SupportedSourcesCard() {
  const sources = [
    { icon: Box, title: "npm Registry", body: "Public npm packages" },
    { icon: Globe, title: "GitHub", body: "Scan from repository" },
    { icon: FileCode2, title: "package.json", body: "Analyze local files" },
    { icon: Terminal, title: "CLI Command", body: "Scan via terminal" },
  ];

  return (
    <section className="dz-card p-4">
      <h2 className="text-[15px] font-bold text-ink">Supported Sources</h2>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {sources.map((s) => (
          <div
            key={s.title}
            className="flex items-center gap-2.5 rounded-[8px] border border-line-soft bg-white px-3 py-2.5"
          >
            <s.icon aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0 text-ink" />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-ink">{s.title}</p>
              <p className="truncate text-[11px] text-label">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RealTimeAnalysisCard() {
  const rows = [
    ["Static code analysis", "Detects malicious patterns"],
    ["Dependency graph analysis", "Checks transitive risks"],
    ["Behavioral analysis", "Analyzes install scripts"],
    ["Network request detection", "Identifies suspicious endpoints"],
    ["AI-powered threat detection", "Finds obfuscated and novel threats"],
    ["Decentralized scanner consensus", "Verified by independent nodes"],
    ["On-chain attestation", "Recorded on Solana Devnet"],
  ];

  return (
    <section className="dz-card p-4">
      <h2 className="text-[15px] font-bold text-ink">Real-time Analysis</h2>
      <ul className="mt-3.5 flex flex-col gap-2.5">
        {rows.map(([label, hint]) => (
          <li key={label} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#EAF6C4]"
            >
              <svg viewBox="0 0 24 24" className="size-3 text-[#556B0A]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            {/* Two-line stack rather than a side-by-side pair: the hints are
                long enough that side-by-side wraps the labels at this width. */}
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] leading-tight text-ink">{label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-tight text-label sm:hidden">
                {hint}
              </span>
            </span>
            <span className="hidden shrink-0 text-[11.5px] whitespace-nowrap text-label sm:block">
              {hint}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UnavailablePanel({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-line px-6 py-14 text-center">
      <p className="text-[14px] font-semibold text-ink">{title} is not available yet</p>
      <p className="mono-body mt-2 max-w-[46ch] text-[12px] leading-[1.6] text-label">
        This input is shown for parity with the reference. It becomes usable once the
        corresponding backend is implemented.
      </p>
    </div>
  );
}

/**
 * The Scanner page's tabbed submission card.
 *
 * Only Single Scan is wired to the real `POST /api/scans` endpoint; the other
 * tabs render an explicit unavailable state rather than pretending to work.
 */
export function ScanTabsCard({
  onSubmit,
  submitting,
  error,
  seed,
  onValue,
}: {
  onSubmit: (value: string) => void;
  submitting: boolean;
  error: string | null;
  /** Value pushed in from the example pills. */
  seed: string;
  onValue: (value: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("single");
  const [value, setValue] = useState("");
  const { satisfied } = useWalletRequirement();

  // Example pills live in the page; they seed this field through `seed`.
  useEffect(() => {
    if (seed) setValue(seed);
  }, [seed]);

  return (
    <section className="dz-card overflow-hidden">
      <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Scan input mode" />

      <div className="p-4">
        <TabPanel id="single" active={tab === "single"}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Always hand off, including when empty, so the parent's
              // validation can explain what is missing.
              onSubmit(value.trim());
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <label className="sr-only" htmlFor="dz-scan-input">
              npm package coordinate
            </label>
            <input
              id="dz-scan-input"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                onValue(e.target.value);
              }}
              placeholder="@unknown/solana-helper@1.4.2"
              autoComplete="off"
              spellCheck={false}
              className="dz-input mono-body min-w-0 flex-1"
            />
            <button
              type="submit"
              /* Enabled when empty so the validation message can explain what
                 is missing — matching the reference, where the button is
                 always actionable. */
              disabled={submitting}
              className="dz-btn-primary shrink-0"
            >
              {submitting ? "Scanning…" : "Scan"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          {error ? (
            <p role="alert" className="mono-body mt-2.5 text-[12px] text-[#8A2C23]">
              {error}
            </p>
          ) : null}
        </TabPanel>

        <TabPanel id="batch" active={tab === "batch"}>
          <UnavailablePanel title="Batch Scan" />
        </TabPanel>
        <TabPanel id="pkgjson" active={tab === "pkgjson"}>
          <UnavailablePanel title="From package.json" />
        </TabPanel>
        <TabPanel id="cli" active={tab === "cli"}>
          <UnavailablePanel title="CLI Command" />
        </TabPanel>
      </div>

      {/* Wallet is OPTIONAL for a manual scan, so this must not read like a
          gate. `useWalletRequirement().reason` is deliberately not reused here:
          its wording ("Connect a Solana wallet to continue.") is true for a
          gated action and false for this one, which proceeds regardless.

          Neither branch claims attribution. `ScanRecord` has no wallet field,
          so the store cannot record who requested a scan — and connecting a
          wallet signs nothing, submits no transaction and verifies no
          attestation. */}
      <p className="mono-body flex items-center gap-2 border-t border-line-soft px-4 py-2.5 text-[11px] text-label">
        <span
          aria-hidden="true"
          className={`size-[7px] shrink-0 rounded-full ${satisfied ? "bg-[#155534]" : "bg-[#C9C6BC]"}`}
        />
        {satisfied
          ? "Wallet connected. Scanning is available; on-chain attestation is not yet configured."
          : "Scanning is available without a wallet. Connecting one does not sign or submit anything on its own."}
      </p>
    </section>
  );
}

export { HowItWorksCard, SupportedSourcesCard, RealTimeAnalysisCard };
