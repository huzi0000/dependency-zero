"use client";

import { Box, Globe, ShieldCheck } from "lucide-react";

import { PageTabs, TabPanel, type TabItem } from "@/components/app/PageTabs";
import { useWalletRequirement } from "@/components/app/WalletRequirement";
import { useEffect, useState } from "react";

type Tab = "single";

/**
 * Only Single Scan is offered.
 *
 * Batch Scan, "From package.json" and "CLI Command" were previously listed as
 * permanently-disabled tabs. A disabled tab can never become active, so its
 * explanatory panel was unreachable and the control rendered as a dead affordance
 * that looked like a missing feature. There is no backend behind any of them, so
 * they are removed rather than shipped as decoration.
 */
const TABS: TabItem<Tab>[] = [{ id: "single", label: "Single Scan" }];

/** Right-rail informational panels from the Scanner reference. */
function HowItWorksCard() {
  const steps = [
    {
      icon: Box,
      title: "Scan",
      body: "Inspect the published tarball, registry metadata and OSV advisories. Package code is never executed.",
    },
    {
      icon: Globe,
      title: "Decide",
      body: "Three local scanner roles sign their findings; a deterministic policy returns ALLOW, REVIEW or BLOCK.",
    },
    {
      icon: ShieldCheck,
      title: "Protect",
      body: "The firewall enforces that verdict before npm runs. Anchoring to Solana Devnet is optional.",
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
  // Only what the scanner actually resolves. GitHub, package.json and CLI
  // input were listed here while the corresponding tabs were non-functional.
  const sources = [
    { icon: Box, title: "npm Registry", body: "Published packages only" },
  ];

  return (
    <section className="dz-card p-4">
      <h2 className="text-[15px] font-bold text-ink">Supported sources</h2>
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
      <p className="mono-body mt-3 text-[11px] leading-[1.5] text-label">
        Git, URLs, local paths and workspace specs are refused rather than
        resolved.
      </p>
    </section>
  );
}

function RealTimeAnalysisCard() {
  /**
   * Every row here is implemented and reachable from a real scan.
   *
   * Previously this list also claimed "AI-powered threat detection", "Dependency
   * graph analysis — checks transitive risks" and "Behavioral analysis". None
   * existed: transitive resolution is hard-coded false, package code is never
   * executed, and there is no model in the pipeline. A green tick beside an
   * unimplemented capability is the least defensible thing this page could
   * show, so those rows are gone rather than reworded.
   */
  const rows: [string, string][] = [
    ["npm metadata & integrity", "Registry record, dist-tags, published hash"],
    ["Published tarball inspection", "Real archive contents, no execution"],
    ["Advisory lookup", "OSV vulnerability records for the package"],
    ["Static pattern detection", "Install scripts and suspicious source"],
    ["Signed scanner evidence", "Three local roles, one operator"],
    ["Deterministic verdict", "ALLOW / REVIEW / BLOCK, no exceptions"],
    ["Optional Solana Devnet anchor", "Proof bundle exported regardless"],
  ];

  return (
    <section className="dz-card p-4">
      <h2 className="text-[15px] font-bold text-ink">What the scanner checks</h2>
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

/**
 * The Scanner page's tabbed submission card.
 *
 * Only Single Scan exists and it is wired to the real `POST /api/scans`
 * endpoint.
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
      {/* The tab bar used to be this card's first child with no padding of its
          own, so "Single Scan" sat flush against the card's top and left edges
          while everything below it had `p-4`. The header now shares that
          inset, with a little extra room above it, so it reads as part of the
          card rather than as something bleeding off its edges.

          `PageTabs` is deliberately NOT touched: it is shared with the Threat
          Report and Network pages, and this wrapper keeps the change local to
          the scanner. The bar's bottom border still lands on the padding box,
          so the divider now spans the full card width as before. */}
      <div className="px-4 pt-3">
        <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Scan input mode" />
      </div>

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
            {/* `flex-1` below is scoped to `sm:` on purpose. Under `sm` this form is a
                COLUMN flex container, so its main axis is vertical and `flex-1`
                sets `flex-basis: 0%` — which overrides the `height: 2.75rem`
                declared by `.dz-input` and collapsed the field to about 19px on
                a phone. From `sm` up the container is a row, `flex-1` grows the
                width as intended, and the height is left to the stylesheet. */}
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
              className="dz-input mono-body min-w-0 sm:flex-1"
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
