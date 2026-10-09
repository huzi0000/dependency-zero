import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { EmptyState } from "@/components/app/EmptyState";
import { relativeTime } from "@/components/app/verdict";
import { explorerAddressUrl } from "@/lib/config";
import { getRpcStatus } from "@/lib/solana";
import { listNodes, listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const [nodes, rpc, scans] = await Promise.all([listNodes(), getRpcStatus(), listScans(1000)]);

  const resolved = scans.filter((s) => s.status !== "pending" && s.status !== "error");
  const attested = scans.filter((s) => s.attestationSignature);
  const voted = resolved.reduce((sum, s) => sum + s.votes, 0);

  return (
    <div className="mx-auto max-w-[1100px]">
      <h1 className="font-sans text-[30px] leading-none font-bold tracking-[-0.02em] text-ink">
        Network
      </h1>
      <p className="mt-2 max-w-[64ch] text-[13.5px] text-label">
        Independent scanner nodes and on-chain attestations on Solana Devnet.
      </p>

      <section className="dz-card mt-5 p-4" aria-labelledby="rpc-status">
        <h2 id="rpc-status" className="text-[15px] font-bold text-ink">
          Solana Devnet
        </h2>
        <div className="mt-3 flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-[8px] rounded-full ${rpc.reachable ? "bg-safe" : "bg-blocked"}`}
          />
          <p className="text-[13.5px] text-ink-soft">
            {rpc.reachable ? "Connected" : "Unreachable"}
          </p>
        </div>
        <dl className="mono-body mt-3 grid gap-x-6 gap-y-1.5 text-[12px] text-label sm:grid-cols-2">
          <div className="flex gap-2">
            <dt>Endpoint</dt>
            <dd className="min-w-0 break-all text-ink">{rpc.endpoint}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Core version</dt>
            <dd className="text-ink">{rpc.version ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Latency</dt>
            <dd className="text-ink">
              {rpc.latencyMs === null ? "—" : `${rpc.latencyMs} ms`}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>Checked</dt>
            <dd className="text-ink">{relativeTime(rpc.checkedAt)}</dd>
          </div>
        </dl>
        {rpc.error ? (
          <p className="mono-body mt-3 text-[12px] text-[#8A2C23]">{rpc.error}</p>
        ) : null}
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Registered nodes", value: String(nodes.length) },
          { label: "Resolved scans", value: String(resolved.length) },
          { label: "On-chain attestations", value: String(attested.length) },
        ].map((cell) => (
          <div key={cell.label} className="dz-card p-4">
            <p className="font-sans text-[24px] leading-none font-bold tracking-[-0.02em] text-ink">
              {cell.value}
            </p>
            <p className="mt-2 text-[12.5px] text-label">{cell.label}</p>
          </div>
        ))}
      </div>

      <section className="dz-card mt-4" aria-labelledby="nodes-heading">
        <h2 id="nodes-heading" className="px-4 pt-4 text-[15px] font-bold text-ink">
          Scanner nodes
        </h2>
        {nodes.length === 0 ? (
          <EmptyState
            title="No scanner nodes registered"
            description="The node registry is empty on this deployment. Node identities, locations and vote counts appear here once scanners register through the ingestion API."
          />
        ) : (
          <ul>
            {nodes.map((node) => (
              <li key={node.id} className="dz-row flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{node.name}</span>
                  <a
                    href={explorerAddressUrl(node.identity)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mono-body inline-flex items-center gap-1 text-[11.5px] text-label underline-offset-4 hover:text-ink hover:underline"
                  >
                    {node.identity.slice(0, 6)}…{node.identity.slice(-4)}
                    <ArrowUpRight aria-hidden="true" strokeWidth={1.8} className="size-3" />
                  </a>
                </span>
                <span className="mono-body text-[11.5px] text-label">
                  {node.scansCompleted} scans
                </span>
                <span className="mono-body w-[70px] text-right text-[11.5px] text-label">
                  {node.lastSeenAt ? relativeTime(node.lastSeenAt) : "never"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dz-card mt-4 p-4" aria-labelledby="consensus-heading">
        <h2 id="consensus-heading" className="text-[15px] font-bold text-ink">
          Consensus
        </h2>
        <p className="mono-body mt-2 text-[12.5px] leading-[1.7] text-label">
          {voted === 0
            ? "Consensus rate is unavailable: no scanner node has voted on a resolved scan yet. A rate is only computed once real votes exist, and is never estimated."
            : `${voted} votes recorded across ${resolved.length} resolved scans. Consensus rate requires a defined quorum, which is not configured on this deployment.`}
        </p>
      </section>
    </div>
  );
}
