import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { CopySignatureButton } from "@/components/app/CopySignatureButton";
import { EmptyState } from "@/components/app/EmptyState";
import { TimeAgo } from "@/components/app/TimeAgo";
import { truncateSignature, VERDICT_META } from "@/components/app/verdict";
import { explorerTxUrl } from "@/lib/config";
import type { ScanRecord } from "@/lib/types";

type Attestation = {
  id: string;
  packageName: string;
  version: string;
  verdict: ScanRecord["status"];
  votes: number;
  signature: string;
  createdAt: string;
};

export function NetworkStats({
  activeNodes,
  totalAttestations,
  consensusRate,
  nodeDelta,
  attestationDelta,
}: {
  activeNodes: number;
  totalAttestations: number;
  consensusRate: number | null;
  nodeDelta: number | null;
  attestationDelta: number | null;
}) {
  const cells = [
    { value: activeNodes.toLocaleString("en-US"), label: "Active Nodes", delta: nodeDelta },
    { value: totalAttestations.toLocaleString("en-US"), label: "Total Attestations", delta: attestationDelta },
    {
      value: consensusRate === null ? "—" : `${consensusRate}%`,
      label: "Consensus Rate",
      delta: null,
    },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-[#E6E3DA] border-b border-line-soft pb-4">
      {cells.map((cell) => (
        <div key={cell.label} className="px-4 first:pl-0">
          <p className="font-sans text-[24px] leading-none font-bold tracking-[-0.02em] text-ink">
            {cell.value === "—" ? (
              <span className="mono-body text-[20px] font-normal text-label">—</span>
            ) : (
              cell.value
            )}
          </p>
          <p className="mt-2 text-[12.5px] text-label">{cell.label}</p>
          {cell.value === "—" ? (
            <p className="mono-body mt-1.5 text-[11px] leading-[1.4] text-label">
              No quorum configured
            </p>
          ) : cell.delta === null ? (
            <p className="mono-body mt-1.5 text-[11.5px] text-label">No prior period</p>
          ) : (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#155534]">
              ↑ {cell.delta}%
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function AttestationsTable({ attestations }: { attestations: Attestation[] }) {
  return (
    <section className="dz-card mt-5 flex flex-col" aria-labelledby="attestations-heading">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 id="attestations-heading" className="font-sans text-[15px] font-bold text-ink">
          Recent Attestations
        </h2>
        {attestations.length > 0 ? (
          <Link
            href="/network"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-label transition-colors hover:text-ink"
          >
            View all
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>

      {attestations.length === 0 ? (
        <EmptyState
          title="No attestations yet"
          description="An attestation is written only after a scan is resolved and anchored to Solana. None have been recorded on this deployment."
        />
      ) : (
        <div className="dz-scroll overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="dz-overline border-b border-line-soft">
                <th scope="col" className="px-4 py-2 font-normal">Package</th>
                <th scope="col" className="px-4 py-2 font-normal">Verdict</th>
                <th scope="col" className="px-4 py-2 font-normal">Nodes</th>
                <th scope="col" className="px-4 py-2 font-normal">Tx Hash</th>
                <th scope="col" className="px-4 py-2 font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {attestations.map((row) => {
                const meta =
                  row.verdict === "allow" || row.verdict === "review" || row.verdict === "block"
                    ? VERDICT_META[row.verdict]
                    : null;
                return (
                  <tr key={row.id} className="dz-row">
                    <td className="mono-body px-4 py-3 text-[12.5px] text-ink">
                      {row.packageName}@{row.version}
                    </td>
                    <td className="px-4 py-3">
                      {meta ? (
                        <span
                          className={`mono-label inline-flex rounded px-2 py-1 text-[9.5px] ${meta.chip}`}
                        >
                          {meta.label === "ALLOW" ? "Allow" : meta.label === "BLOCK" ? "Block" : "Warn"}
                        </span>
                      ) : (
                        <span className="mono-label inline-flex rounded bg-[#EFEDE4] px-2 py-1 text-[9.5px] text-label">
                          {row.verdict}
                        </span>
                      )}
                    </td>
                    <td className="mono-body px-4 py-3 text-[12.5px] text-label">{row.votes}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <a
                          href={explorerTxUrl(row.signature)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mono-body inline-flex items-center gap-1 text-[12.5px] text-label underline-offset-4 hover:text-ink hover:underline"
                        >
                          {truncateSignature(row.signature)}
                          <ArrowUpRight aria-hidden="true" strokeWidth={1.8} className="size-3" />
                        </a>
                        <CopySignatureButton value={row.signature} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-label">
                      <TimeAgo
                        iso={row.createdAt}
                        className="mono-body"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
