"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { CopyValue } from "@/components/app/CopyValue";
import { EmptyState } from "@/components/app/EmptyState";
import { NetworkHowItWorks } from "@/components/app/NetworkHowItWorks";
import { KvRow, Panel } from "@/components/app/Panels";
import { AttestationSignature } from "@/components/app/AttestationSignature";
import { SegmentedPanel, SegmentedTabs } from "@/components/app/SegmentedTabs";
import { TimeAgo } from "@/components/app/TimeAgo";
import { explorerTxUrl } from "@/lib/config";
import { activeNodes, type NetworkData } from "@/lib/network-types";

type Tab = "overview" | "scanners" | "attestations" | "registry";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "scanners", label: "Scanners" },
  { id: "attestations", label: "Attestations" },
  { id: "registry", label: "Registry" },
];

/* -------------------------------------------------------------------------- */
/* Shared cards                                                               */
/* -------------------------------------------------------------------------- */

function SolanaRegistryCard({ data }: { data: NetworkData }) {
  const { rpc, nodes, attestations } = data;
  return (
    <Panel
      title="Solana Registry"
      icon={<RegistryIcon />}
      action={
        <span className="mono-body text-[11px] text-label">
          {rpc.reachable ? "Connected" : "Unreachable"}
        </span>
      }
    >
      <p className="text-[12px] text-label">Verified scanner nodes registered on-chain.</p>
      <dl className="mt-3">
        <KvRow label="Program ID" mono>
          <span className="text-label">Not deployed</span>
        </KvRow>
        <KvRow label="Total Registered" mono>
          {nodes.length > 0 ? nodes.length : "—"}
        </KvRow>
        <KvRow label="Active Nodes" mono>
          {activeNodes(nodes) > 0 ? activeNodes(nodes) : "—"}
        </KvRow>
        <KvRow label="Attestations" mono>
          {attestations.length > 0 ? attestations.length : "—"}
        </KvRow>
        <KvRow label="Cluster">Solana Devnet</KvRow>
        <KvRow label="RPC Health">
          <span className={rpc.reachable ? "text-[#155534]" : "text-[#8A2C23]"}>
            {rpc.reachable ? "Reachable" : "Unreachable"}
          </span>
        </KvRow>
        <KvRow label="Last Checked">
          <TimeAgo iso={rpc.checkedAt} className="mono-body" />
        </KvRow>
      </dl>
      <p className="mono-body mt-3 rounded-[6px] border border-line-soft bg-[#F6F4ED] px-2.5 py-2 text-[11px] leading-[1.5] text-label">
        The Solana program is not deployed on this environment, so no registry account or
        program id exists to link. RPC reachability above is measured live.
      </p>
    </Panel>
  );
}

function ScannerNodesTable({ data }: { data: NetworkData }) {
  const { nodes } = data;
  if (nodes.length === 0) {
    return (
      <EmptyState
        title="No scanner nodes registered"
        description="The node registry is empty on this deployment. Scanners appear here with their identity and scan count once they register."
      />
    );
  }
  return (
    <div className="dz-scroll w-full max-w-full overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-left">
        <thead>
          <tr className="dz-overline border-b border-line-soft">
            <th scope="col" className="px-4 py-2 font-normal">Scanner</th>
            <th scope="col" className="px-4 py-2 font-normal">Identity</th>
            <th scope="col" className="px-4 py-2 font-normal">Scans</th>
            <th scope="col" className="px-4 py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id} className="dz-row">
              <td className="px-4 py-3">
                <Link href="/scan" className="text-[12.5px] text-ink hover:underline">
                  {node.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <a
                  href={`https://explorer.solana.com/address/${node.identity}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mono-body inline-flex items-center gap-1 text-[12px] text-label hover:text-ink"
                >
                  {node.identity.slice(0, 6)}…{node.identity.slice(-4)}
                  <ArrowUpRight aria-hidden="true" strokeWidth={1.8} className="size-3" />
                </a>
              </td>
              <td className="mono-body px-4 py-3 text-[12px] text-label">{node.scansCompleted}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink">
                  <span
                    aria-hidden="true"
                    className={`size-[7px] rounded-full ${node.lastSeenAt ? "bg-[#21875A]" : "bg-[#C9C6BC]"}`}
                  />
                  {node.lastSeenAt ? "Online" : "Never seen"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScannerNodesCard({ data }: { data: NetworkData }) {
  return (
    <section className="dz-card flex flex-col" aria-labelledby="scanner-nodes">
      <div className="px-4 pt-4 pb-2">
        <h2 id="scanner-nodes" className="text-[15px] font-bold text-ink">
          Scanner Nodes
        </h2>
        <p className="mt-1 text-[12.5px] text-label">
          Independent scanners analyzing packages and submitting signed attestations.
        </p>
      </div>
      <ScannerNodesTable data={data} />
    </section>
  );
}

function ConsensusCard({ data }: { data: NetworkData }) {
  const { resolved } = data;
  return (
    <section className="dz-card flex flex-col" aria-labelledby="consensus-activity">
      <div className="px-4 pt-4 pb-2">
        <h2 id="consensus-activity" className="text-[15px] font-bold text-ink">
          Latest Consensus Activity
        </h2>
        <p className="mt-1 text-[12.5px] text-label">
          Verdicts produced by independent scanners.
        </p>
      </div>
      {resolved.length === 0 ? (
        <EmptyState
          title="No consensus events yet"
          description="Consensus appears here once scanner nodes submit signed verdicts for a scan."
        />
      ) : (
        <div className="dz-scroll w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="dz-overline border-b border-line-soft">
                <th scope="col" className="px-4 py-2 font-normal">Package</th>
                <th scope="col" className="px-4 py-2 font-normal">Verdict</th>
                <th scope="col" className="px-4 py-2 font-normal">Scanners</th>
                <th scope="col" className="px-4 py-2 font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {resolved.slice(0, 10).map((s) => (
                <tr key={s.id} className="dz-row">
                  <td className="px-4 py-3">
                    <Link href={`/scan/${s.id}`} className="mono-body text-[12.5px] text-ink hover:underline">
                      {s.packageName}
                    </Link>
                  </td>
                  <td className="mono-label px-4 py-3 text-[10px] uppercase text-label">{s.status}</td>
                  <td className="mono-body px-4 py-3 text-[12px] text-label">{s.votes}</td>
                  <td className="px-4 py-3">
                    <TimeAgo iso={s.createdAt} className="mono-body text-[12px] text-label" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AttestationsList({ data }: { data: NetworkData }) {
  const { attestations } = data;
  if (attestations.length === 0) {
    return (
      <p className="mono-body py-4 text-center text-[12px] leading-[1.6] text-label">
        No on-chain attestations yet. One is written only after a scan is resolved and
        anchored to Solana.
      </p>
    );
  }
  return (
    <ul>
      {attestations.map((a) => (
        <li key={a.id} className="dz-row">
          <Link href={`/scan/${a.id}`} className="flex items-center gap-3 px-1 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="mono-body block truncate text-[12.5px] text-ink">
                {a.packageName}
              </span>
              <span className="mono-body block text-[11.5px] text-label">
                {a.version} · 
                <AttestationSignature signature={a.signature} className="mono-body inline text-[11.5px] text-label" />
              </span>
            </span>
            <TimeAgo iso={a.createdAt} className="mono-body shrink-0 text-[11.5px] text-label" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AttestationsCard({ data }: { data: NetworkData }) {
  return (
    <Panel title="Recent On-chain Attestations" bodyClassName="px-4 pb-4">
      <AttestationsList data={data} />
    </Panel>
  );
}

function AttestationDetails({ data }: { data: NetworkData }) {
  const a = data.attestations[0];
  if (!a) {
    return (
      <Panel title="Attestation Details">
        <p className="mono-body py-2 text-[12px] leading-[1.6] text-label">
          No attestation to detail. A transaction signature, findings hash and signer
          record appear here once a verdict is anchored on Solana Devnet.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Attestation Details">
      <dl>
        <KvRow label="Transaction" mono>
          {a.signature ? (
                      <CopyValue
                        value={a.signature}
                        display={`${a.signature.slice(0, 4)}…${a.signature.slice(-4)}`}
                        label="Copy signature"
                      />
                    ) : (
                      <span className="text-label">Not anchored</span>
                    )}
        </KvRow>
        <KvRow label="Package" mono>
          {a.packageName}@{a.version}
        </KvRow>
        <KvRow label="Mechanism">
          <span className="text-[11.5px] leading-[1.5]">{a.mechanism}</span>
        </KvRow>
        <KvRow label="Commitment" mono>
          {a.commitmentHash.slice(0, 12)}…
        </KvRow>
        <KvRow label="Slot" mono>
          {a.slot ?? "—"}
        </KvRow>
        <KvRow label="Verdict">{a.verdict.toUpperCase()}</KvRow>
        <KvRow label="Timestamp">
          <TimeAgo iso={a.createdAt} className="mono-body" />
        </KvRow>
      </dl>
{a.signature ? (
        <a
          href={explorerTxUrl(a.signature)}
          target="_blank"
          rel="noreferrer noopener"
          className="dz-btn-ghost mt-3 w-full"
        >
          View on Solana Explorer
          <ArrowUpRight aria-hidden="true" strokeWidth={1.8} className="size-3.5" />
        </a>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

function RegistryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 8-9-5-9 5v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  );
}

export function NetworkView({ data }: { data: NetworkData }) {
  const [tab, setTab] = useState<Tab>("overview");
  const active = activeNodes(data.nodes);
  const resolvedCount = data.resolved.length;

  const stats = [
    { label: "Active Nodes", value: active },
    { label: "Registered Nodes", value: data.nodes.length },
    { label: "Total Attestations", value: data.attestations.length },
    { label: "Resolved Scans", value: resolvedCount },
  ];

  return (
    <div className="mx-auto min-w-0 max-w-[1280px]">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="dz-eyebrow">Network</p>
          <h1 className="mt-2 font-sans text-[34px] leading-[1.05] font-bold tracking-[-0.025em] text-ink">
            Scanner Network
          </h1>
          <p className="mt-2 max-w-[62ch] text-[13.5px] text-label">
            Independent scanners. On-chain attestations. Transparent trust.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 rounded-[8px] border border-line-soft bg-white px-3.5 py-2.5">
            <span
              aria-hidden="true"
              className={`size-[8px] rounded-full ${data.rpc.reachable ? "bg-[#21875A]" : "bg-[#D94A3D]"}`}
            />
            <span className="text-[13px] text-ink">Solana Devnet</span>
            <span className="mono-body text-[12px] text-label">
              {data.rpc.reachable ? "Connected" : "Unreachable"}
            </span>
          </div>
          <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} label="Network sections" />
        </div>
      </div>

      {/* ------------------------------------------------------ key numbers */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((cell) => (
          <div key={cell.label} className="dz-card p-4">
            <p className="font-sans text-[26px] leading-none font-bold tracking-[-0.02em] text-ink">
              {cell.value}
            </p>
            <p className="mt-2 text-[12.5px] text-label">{cell.label}</p>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------- overview */}
      <SegmentedPanel id="overview" active={tab === "overview"} className="mt-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="flex min-w-0 flex-col gap-4">
            <NetworkHowItWorks registeredNodes={data.nodes.length} />
            <ScannerNodesCard data={data} />
            <ConsensusCard data={data} />
          </div>
          <aside className="flex min-w-0 flex-col gap-4">
            <SolanaRegistryCard data={data} />
            <AttestationsCard data={data} />
          </aside>
        </div>
      </SegmentedPanel>

      {/* ---------------------------------------------------------- scanners */}
      <SegmentedPanel id="scanners" active={tab === "scanners"} className="mt-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <ScannerNodesCard data={data} />
          <aside className="flex min-w-0 flex-col gap-4">
            <Panel title="Node Identities">
              <p className="mono-body text-[12px] leading-[1.6] text-label">
                {data.nodes.length > 0
                  ? "Each row links to its address on the Solana Devnet Explorer."
                  : "No identities exist yet. A scanner publishes a base58 public key here once it registers."}
              </p>
            </Panel>
          </aside>
        </div>
      </SegmentedPanel>

      {/* ------------------------------------------------------ attestations */}
      <SegmentedPanel id="attestations" active={tab === "attestations"} className="mt-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <AttestationsCard data={data} />
          <aside className="flex min-w-0 flex-col gap-4">
            <AttestationDetails data={data} />
          </aside>
        </div>
      </SegmentedPanel>

      {/* ---------------------------------------------------------- registry */}
      <SegmentedPanel id="registry" active={tab === "registry"} className="mt-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <SolanaRegistryCard data={data} />
          <aside className="flex min-w-0 flex-col gap-4">
            <Panel title="Verification">
              <p className="mono-body text-[12px] leading-[1.6] text-label">
                Verification becomes available once the program is deployed and an attestation
                carries a real transaction signature. No signature is displayed or linked
                before then.
              </p>
            </Panel>
          </aside>
        </div>
      </SegmentedPanel>
    </div>
  );
}
