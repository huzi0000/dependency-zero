import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { CopySignatureButton } from "@/components/app/CopySignatureButton";
import { StatusChip, relativeTime } from "@/components/app/verdict";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/config";
import { getScan } from "@/lib/store";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="dz-row grid grid-cols-[132px_1fr] gap-3 px-4 py-3">
      <dt className="dz-overline pt-0.5">{label}</dt>
      <dd className="mono-body min-w-0 break-words text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

export default async function ScanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scan = await getScan(id);
  if (!scan) notFound();

  return (
    <div className="mx-auto max-w-[900px]">
      <Link
        href="/scan"
        className="mono-body inline-flex items-center gap-1.5 text-[12.5px] text-label transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.8} className="size-3.5" />
        Back to scans
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="mono-body text-[22px] font-semibold break-all text-ink">
          {scan.packageName}@{scan.version}
        </h1>
        <StatusChip status={scan.status} />
      </div>
      <p className="mt-2 text-[13px] text-label">
        Requested {relativeTime(scan.createdAt)} · id{" "}
        <span className="mono-body">{scan.id.slice(0, 8)}</span>
      </p>

      <section className="dz-card mt-5" aria-labelledby="scan-detail">
        <h2 id="scan-detail" className="px-4 pt-4 text-[15px] font-bold text-ink">
          Report
        </h2>
        <dl className="mt-2">
          <Row label="Package">{scan.packageName}</Row>
          <Row label="Version">{scan.version}</Row>
          <Row label="Status">{scan.status}</Row>
          <Row label="Node votes">{scan.votes}</Row>
          <Row label="Resolved by">
            {scan.resolvedBy ? (
              <a
                href={explorerAddressUrl(scan.resolvedBy)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              >
                {scan.resolvedBy}
                <ArrowUpRight aria-hidden="true" strokeWidth={1.8} className="size-3" />
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Attestation">
            {scan.attestationSignature ? (
              // The link and the copy button are siblings — never nested.
              <span className="inline-flex flex-wrap items-center gap-2">
                <a
                  href={explorerTxUrl(scan.attestationSignature)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  {scan.attestationSignature}
                  <ArrowUpRight aria-hidden="true" strokeWidth={1.8} className="size-3" />
                </a>
                <CopySignatureButton value={scan.attestationSignature} />
              </span>
            ) : (
              "Not yet attested on chain"
            )}
          </Row>
        </dl>
      </section>

      <section className="dz-card mt-4" aria-labelledby="findings">
        <h2 id="findings" className="px-4 pt-4 text-[15px] font-bold text-ink">
          Findings
        </h2>
        {scan.findings.length === 0 ? (
          <p className="mono-body px-4 py-8 text-center text-[12.5px] leading-[1.6] text-label">
            {scan.status === "pending"
              ? "Awaiting a scanner verdict. No findings have been reported for this dependency."
              : "No findings were reported for this dependency."}
          </p>
        ) : (
          <ul>
            {scan.findings.map((f, i) => (
              <li key={`${f.rule}-${i}`} className="dz-row px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono-body text-[12.5px] text-ink">{f.rule}</span>
                  <span className="mono-label rounded bg-[#F0EEE6] px-1.5 py-0.5 text-[9px] text-label">
                    {f.severity}
                  </span>
                </div>
                <p className="mono-body mt-1 text-[12px] text-label">{f.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
