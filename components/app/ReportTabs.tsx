"use client";

import { useState } from "react";

import { PageTabs, TabPanel, type TabItem } from "@/components/app/PageTabs";
import { CodeEvidence, KeyThreats } from "@/components/app/ReportVisuals";
import { EmptyState } from "@/components/app/EmptyState";
import type { ScanRecord } from "@/lib/types";

type Tab = "overview" | "threats" | "behavior" | "verdicts" | "proof";

/**
 * Tab bar from the Threat Report reference.
 *
 * Overview renders nothing itself — the server page draws the full report
 * body, and the tab strip is rendered above it. The remaining tabs are honest
 * placeholders: there is no scanner engine, behaviour trace, node-level
 * verdict log or attestation yet, so they say so rather than showing invented
 * content.
 */
export function ReportTabs({
  scan,
  threatCount,
}: {
  scan: ScanRecord;
  threatCount: number;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: TabItem<Tab>[] = [
    { id: "overview", label: "Overview" },
    { id: "threats", label: "Threats", badge: threatCount || undefined },
    { id: "behavior", label: "Behavior" },
    { id: "verdicts", label: "Network Verdicts" },
    { id: "proof", label: "On-chain Proof" },
  ];

  const pending = scan.status === "pending";

  return (
    <>
      <PageTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        label="Threat report sections"
        className="mt-6"
      />

      {tab !== "overview" ? (
        <div className="mt-4">
          <TabPanel id="threats" active={tab === "threats"}>
            <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
              <KeyThreats findings={scan.findings} />
              <CodeEvidence />
            </div>
          </TabPanel>

          <TabPanel id="behavior" active={tab === "behavior"}>
            <div className="dz-card">
              <EmptyState
                title="No behaviour trace yet"
                description={
                  pending
                    ? "Install-script and runtime behaviour is recorded here once a scanner node executes the package."
                    : "Behavioural analysis is not recorded for this scan."
                }
              />
            </div>
          </TabPanel>

          <TabPanel id="verdicts" active={tab === "verdicts"}>
            <div className="dz-card">
              <EmptyState
                title="No node verdicts yet"
                description="Per-scanner verdicts and the vote tally appear here once independent scanner nodes register and evaluate this package."
              />
            </div>
          </TabPanel>

          <TabPanel id="proof" active={tab === "proof"}>
            <div className="dz-card">
              <EmptyState
                title="Not yet attested on Solana Devnet"
                description="An on-chain proof is written only after a verdict is finalised and anchored in a transaction. No transaction exists for this scan."
              />
            </div>
          </TabPanel>
        </div>
      ) : null}
    </>
  );
}
