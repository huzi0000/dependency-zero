import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ShieldAlert } from "lucide-react";

import { DependencyGraph } from "@/components/app/DependencyGraph";
import { RiskDial, ConsensusDonut } from "@/components/app/Dials";
import { KvRow, Panel } from "@/components/app/Panels";
import { CopyValue } from "@/components/app/CopyValue";
import { CodeEvidence, KeyThreats } from "@/components/app/ReportVisuals";
import { ReportTabs } from "@/components/app/ReportTabs";
import { TimeAgo } from "@/components/app/TimeAgo";
import { explorerTxUrl } from "@/lib/config";
import { getScan } from "@/lib/store";
import type { ScanStatus } from "@/lib/types";
import { toneForStatus } from "@/lib/verdict-tone";

export const dynamic = "force-dynamic";

const VERDICT_COPY: Record<ScanStatus, { label: string; sub: string; tone: string }> = {
  block: { label: "BLOCKED", sub: "Malicious behaviour detected", tone: "text-[#8A2C23]" },
  review: { label: "REVIEW", sub: "Manual review recommended", tone: "text-[#6B440B]" },
  allow: { label: "SAFE", sub: "No threats detected", tone: "text-[#155534]" },
  pending: { label: "PENDING", sub: "Awaiting scanner verdict", tone: "text-label" },
  error: { label: "ERROR", sub: "Scan did not complete", tone: "text-[#8A2C23]" },
};

/** Fixed format so the width never jitters between records. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SectionHead({
  title,
  icon,
}: {
  title: string;
  icon?: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-ink">
      {icon}
      {title}
    </h2>
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

  const verdict = VERDICT_COPY[scan.status];
  const tone = toneForStatus(scan.status);
  const coordinate = `${scan.packageName}@${scan.version}`;

  // Only real data is rendered. There is no risk score, no consensus and no
  // attestation until a scanner node and the Solana program exist.
  const riskScore = null;
  const votes = scan.votes;
  const blockVotes = scan.status === "block" ? votes : 0;
  const reviewVotes = scan.status === "review" ? votes : 0;
  const allowVotes = scan.status === "allow" ? votes : 0;

  const scanDate = formatDate(scan.createdAt);

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* ---------------------------------------------------------- breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <li>
            <Link href="/scan" className="text-label transition-colors hover:text-ink">
              Scan
            </Link>
          </li>
          <ChevronRight aria-hidden="true" strokeWidth={1.8} className="size-3.5 text-faint" />
          <li className="mono-body text-label">{coordinate}</li>
          <ChevronRight aria-hidden="true" strokeWidth={1.8} className="size-3.5 text-faint" />
          <li aria-current="page" className="text-ink">
            Threat Report
          </li>
        </ol>
      </nav>

      {/* ------------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mono-body text-[30px] leading-none font-bold break-all text-ink">
              {scan.packageName}
            </h1>
            <span className="mono-body rounded-full border border-line-soft bg-white px-3 py-1 text-[13px] text-ink">
              {scan.version}
            </span>
          </div>
          <p className="mono-body mt-2 text-[12px] text-label">
            npm / {scan.packageName} / {scan.version}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <div>
            <p className="dz-overline">Scan ID</p>
            <div className="mt-1.5 flex items-center gap-2 rounded-[7px] border border-line-soft bg-white px-3 py-1.5">
              {/* `display` is truncated for layout; the clipboard always receives
                  the complete scan id, not the visible fragment. */}
              <CopyValue
                value={scan.id}
                display={`${scan.id.slice(0, 10)}…`}
                label="Copy full scan id"
              />
            </div>
          </div>
          <div>
            <p className="dz-overline">Scanned</p>
            <p className="mt-1.5 text-[12.5px] text-ink">{scanDate}</p>
            <TimeAgo
              iso={scan.createdAt}
              className="mono-body mt-0.5 block text-[12px] text-label"
            />
          </div>
          <div
            className={`flex items-center gap-3 rounded-[8px] border px-4 py-2.5 ${
              scan.status === "block"
                ? "border-[#E8B4AC] bg-[#FDF2F0]"
                : scan.status === "review"
                  ? "border-[#EBD3A4] bg-[#FDF7EA]"
                  : scan.status === "allow"
                    ? "border-[#B9D9C6] bg-[#F1F8F4]"
                    : "border-line-soft bg-white"
            }`}
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                scan.status === "block"
                  ? "bg-[#FBE9E6]"
                  : scan.status === "review"
                    ? "bg-[#FBF0DC]"
                    : scan.status === "allow"
                      ? "bg-[#E6F3EC]"
                      : "bg-[#EFEDE4]"
              }`}
            >
              <ShieldAlert aria-hidden="true" strokeWidth={1.8} className={`size-5 ${verdict.tone}`} />
            </span>
            <span>
              <span className={`block text-[15px] leading-none font-bold ${verdict.tone}`}>
                {verdict.label}
              </span>
              <span className="mt-1 block text-[11.5px] text-label">{verdict.sub}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- section tabs */}
      <ReportTabs scan={scan} threatCount={scan.findings.length} />

      {/* -------------------------------------------------------------- body */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* ------------------------------------------------------- left column */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Verdict hero */}
          <section
            className={`dz-card flex flex-wrap items-center gap-6 p-5 ${
              scan.status === "block" ? "dz-card-alert" : ""
            }`}
            aria-labelledby="verdict-heading"
          >
            <RiskDial tone={tone} score={riskScore} />
            <div className="min-w-0 flex-1">
              <h2 id="verdict-heading" className={`text-[32px] leading-none font-bold ${verdict.tone}`}>
                {verdict.label}
              </h2>
              <p className="mono-body mt-2 text-[13px] text-ink">{coordinate}</p>
              {/* PENDING is the expected state for every scan until a scanner
                  node answers. Say so next to the verdict so it reads as a
                  deliberate queue rather than a broken or half-loaded report. */}
              {scan.status === "pending" ? (
                <p className="mono-body mt-2.5 max-w-[52ch] text-[11.5px] leading-[1.6] text-label">
                  This scan record is queued and persisted. Analysis has not run, so no
                  verdict, risk score, findings or attestation exist yet.
                </p>
              ) : null}
              <div className="mono-body mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-label">
                <span>
                  <span className="mr-1.5">Type</span>
                  <span className="text-ink">npm</span>
                </span>
                <span>
                  <span className="mr-1.5">Size</span>
                  <span className="text-ink">—</span>
                </span>
                {/* Publish date is npm registry metadata, not something the
                    store holds. It stays a dash rather than borrowing the scan
                    timestamp, which would mislabel the scan time as publish time. */}
                <span>
                  <span className="mr-1.5">Published</span>
                  <span className="text-ink">—</span>
                </span>
              </div>
            </div>

            <div className="border-l border-line pl-6">
              <p className="dz-overline">Risk Score</p>
              <p className="mt-1.5 font-sans text-[34px] leading-none font-bold text-ink">
                {riskScore === null ? (
                  <span className="mono-body text-[26px] font-normal text-label">—</span>
                ) : (
                  riskScore
                )}
                <span className="ml-1 text-[15px] font-normal text-label">/ 100</span>
              </p>
            </div>
          </section>

          {/* Summary + consensus */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="Summary" className="min-w-0">
              <p className="mono-body text-[12.5px] leading-[1.65] text-ink-soft">
                {scan.status === "pending"
                  ? "This scan is queued. A verdict, risk score and threat list appear once a registered scanner node evaluates the package."
                  : scan.status === "error"
                    ? "The scan did not complete. Re-run it from the Scanner page."
                    : `The network returned a ${verdict.label.toLowerCase()} verdict for this package.`}
              </p>
            </Panel>

            <Panel
              title="Scanner Consensus"
              icon={<ConsensusIcon />}
              className="min-w-0"
            >
              <div className="flex items-center gap-5">
                <ConsensusDonut block={blockVotes} review={reviewVotes} allow={allowVotes} size={104} />
                <ul className="flex flex-1 flex-col gap-2.5">
                  {[
                    { label: "Block", value: blockVotes, color: "bg-[#D94A3D]", text: "text-[#8A2C23]" },
                    { label: "Review", value: reviewVotes, color: "bg-[#B87918]", text: "text-[#6B440B]" },
                    { label: "Allow", value: allowVotes, color: "bg-[#21875A]", text: "text-[#155534]" },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-[9px] rounded-full ${row.value > 0 ? row.color : "bg-[#D8D5CC]"}`}
                      />
                      <span className="mono-body text-[12px] text-label">{row.value}</span>
                      <span className={`ml-auto text-[12px] ${row.value > 0 ? row.text : "text-label"}`}>
                        {row.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {votes === 0 ? (
                <p className="mono-body mt-3 text-[11px] text-label">
                  No scanner node has voted on this scan.
                </p>
              ) : null}
            </Panel>
          </div>

          {/* Threats + attestation */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KeyThreats findings={scan.findings} />

            <Panel title="On-chain Attestation" icon={<AttestationIcon />}>
              <dl>
                <KvRow label="Network">Solana Devnet</KvRow>
                <KvRow label="Transaction" mono>
                  {scan.attestationSignature ? (
                    <a
                      href={explorerTxUrl(scan.attestationSignature)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-4 hover:text-[#155534]"
                    >
                      {scan.attestationSignature.slice(0, 4)}…{scan.attestationSignature.slice(-4)}
                    </a>
                  ) : (
                    "—"
                  )}
                </KvRow>
                <KvRow label="Block" mono>
                  {scan.attestationSignature ? "—" : "—"}
                </KvRow>
                <KvRow label="Timestamp">
                  <TimeAgo iso={scan.createdAt} className="mono-body" />
                </KvRow>
                <KvRow label="Status">
                  {scan.attestationSignature ? (
                    <span className="text-[#155534]">Attested</span>
                  ) : (
                    <span className="text-[#8A2C23]">Not yet attested on Solana Devnet</span>
                  )}
                </KvRow>
              </dl>
              {scan.attestationSignature ? (
                <a
                  href={explorerTxUrl(scan.attestationSignature)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dz-btn-ghost mt-3 w-full"
                >
                  View on Explorer
                  <span aria-hidden="true">↗</span>
                </a>
              ) : null}
            </Panel>
          </div>

          <DependencyGraph
            root={{ id: scan.id, label: scan.packageName, version: scan.version }}
            edges={[]}
          />
        </div>

        {/* ------------------------------------------------------ right column */}
        <aside className="flex min-w-0 flex-col gap-4">
          <Panel title="Package Information" icon={<PackageIcon />}>
            <dl>
              <KvRow label="Package Name" mono>
                {scan.packageName}
              </KvRow>
              <KvRow label="Version" mono>
                {scan.version}
              </KvRow>
              <KvRow label="Publisher">—</KvRow>
              <KvRow label="First Published">—</KvRow>
              <KvRow label="Last Updated">—</KvRow>
              <KvRow label="License">—</KvRow>
              <KvRow label="Downloads (weekly)">—</KvRow>
              <KvRow label="Repository">—</KvRow>
            </dl>
          </Panel>

          <CodeEvidence />

          <Panel title="Scan Metadata" icon={<MetadataIcon />}>
            <dl>
              <KvRow label="Scanner Version" mono>
                —
              </KvRow>
              <KvRow label="Scan Duration" mono>
                —
              </KvRow>
              <KvRow label="Analysis Depth">—</KvRow>
              <KvRow label="Files Analyzed" mono>
                —
              </KvRow>
              <KvRow label="Heuristics Used" mono>
                —
              </KvRow>
              <KvRow label="AI Agent">—</KvRow>
              <KvRow label="Created At">{scanDate}</KvRow>
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/* Small inline icons so the panel headings match the reference exactly. */
function ConsensusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9" />
    </svg>
  );
}
function AttestationIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}
function PackageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 8-9-5-9 5v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  );
}
function MetadataIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h6M9 13h6M9 17h4" />
    </svg>
  );
}
