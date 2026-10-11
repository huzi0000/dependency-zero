import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ShieldAlert } from "lucide-react";

import { DependencyGraph } from "@/components/app/DependencyGraph";
import { RiskDial, ConsensusDonut } from "@/components/app/Dials";
import { KvRow, Panel } from "@/components/app/Panels";
import { CopyValue } from "@/components/app/CopyValue";
import { RescanButton } from "@/components/app/RescanButton";
import { CodeEvidence, KeyThreats } from "@/components/app/ReportVisuals";
import {
  ReportTabs,
  type ReportAttestation,
  type ReportConsensus,
} from "@/components/app/ReportTabs";
import { TimeAgo } from "@/components/app/TimeAgo";
import { explorerTxUrl, SOLANA_CLUSTER } from "@/lib/config";
import { canonicalizeScannerResult } from "@/lib/attest/canonical";
import { verifySignature } from "@/lib/attest/verify-signature";
import { getAttestation, getScan } from "@/lib/store";
import type { ScanStatus } from "@/lib/types";
import { toneForStatus } from "@/lib/verdict-tone";

export const dynamic = "force-dynamic";

const VERDICT_COPY: Record<ScanStatus, { label: string; sub: string; tone: string }> = {
  block: { label: "BLOCKED", sub: "Installation blocked by security policy", tone: "text-[#8A2C23]" },
  review: { label: "REVIEW", sub: "Manual review recommended", tone: "text-[#6B440B]" },
  allow: { label: "SAFE", sub: "No threats detected", tone: "text-[#155534]" },
  pending: { label: "PENDING", sub: "Awaiting scanner verdict", tone: "text-label" },
  error: { label: "ERROR", sub: "Scan did not complete", tone: "text-[#8A2C23]" },
};

/** Shown wherever the registry genuinely did not publish a value. */
const NA = "Not available";

/**
 * Normalise a registry `repository` field into a browsable https URL.
 *
 * The registry stores values like "git+https://github.com/lodash/lodash.git".
 * Anything that does not parse as an http(s) URL returns null so the UI falls
 * back to plain text rather than emitting a dangerous href.
 */
function repositoryUrl(raw: string): string | null {
  let s = raw.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!/^https?:\/\//i.test(s)) {
    if (/^github\.com\//i.test(s)) s = `https://${s}`;
    else if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`;
    else return null;
  }
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

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

  /**
   * The real scan result, when this record was produced by the scanner.
   *
   * Legacy records written before the scanner existed have no `resolution`, no
   * `phase` and no verdict. They are shown honestly as unresolved and offered a
   * rescan; nothing is inferred or back-filled for them.
   */
  const result = scan.resolution ?? null;
  const isLegacy = !scan.phase && !result;

  /**
   * Real consensus, when this scan produced one.
   *
   * These votes come from the three locally operated analytical modules, each
   * signed with its own Ed25519 key and verified against the scanner registry.
   * They are NOT third-party operators: one machine holds all three keys, so
   * this is internal consistency and tamper-evidence, not decentralisation.
   * Legacy scans carry no attestation and correctly show no votes at all.
   */
  const stored = await getAttestation(scan.id);
  const consensus = stored?.consensus ?? null;
  const votes = consensus ? consensus.votes.length : 0;
  const countVote = (v: "block" | "review" | "allow") =>
    consensus ? consensus.votes.filter((x) => x.verdict === v).length : 0;
  const blockVotes = countVote("block");
  const reviewVotes = countVote("review");
  const allowVotes = countVote("allow");
  const attestation = stored?.attestation ?? null;

  /**
   * Serialisable view of the real signed consensus for the Report tabs.
   *
   * Signature verification is re-derived here rather than copied from a stored
   * boolean, so a tampered payload cannot render as verified in the UI.
   */
  const reportConsensus: ReportConsensus | null = (() => {
    if (!stored) return null;
    const b = stored.bundle;
    const byKey = new Map(b.registry.entries.map((e) => [e.publicKeyHex, e]));
    return {
      verified: stored.consensus.verified,
      result: stored.consensus.result,
      quorumMet: stored.consensus.quorumMet,
      quorumRequired: stored.consensus.quorumRequired,
      policyVersion: stored.consensus.policyVersion,
      rationale: stored.consensus.rationale,
      blockOverride: stored.consensus.blockOverride,
      votes: b.scanners.map((s) => {
        const entry = byKey.get(s.payload.scannerPublicKey);
        const good = entry
          ? verifySignature(canonicalizeScannerResult(s.payload), s.signature, entry.publicKeyDer)
          : false;
        return {
          role: s.payload.scannerRole,
          verdict: s.payload.proposedVerdict,
          riskScore: s.payload.riskScore,
          publicKeyHex: s.payload.scannerPublicKey,
          operator: entry?.operator ?? "unknown",
          signature: s.signature,
          signatureVerified: good,
          findingsContribution: s.payload.findingCount,
        };
      }),
      rejected: stored.consensus.rejected.map((r) => ({
        role: r.role,
        reason: r.reason,
        detail: r.detail,
      })),
      unavailableRoles: stored.consensus.unavailableRoles,
    };
  })();

  const reportAttestation: ReportAttestation | null = attestation && stored
    ? {
        status: attestation.status,
        confirmed: attestation.confirmed,
        transactionSignature: attestation.transactionSignature,
        slot: attestation.slot,
        blockTime: attestation.blockTime,
        confirmationStatus: attestation.confirmationStatus,
        explorerUrl: attestation.explorerUrl,
        commitmentHash: attestation.commitmentHash || stored.bundle.commitment,
        mechanismLabel: attestation.mechanismLabel,
        cluster: attestation.cluster,
        memoProgramId: attestation.memoProgramId,
        error: attestation.error,
        submittedAt: attestation.submittedAt,
        confirmedAt: attestation.confirmedAt,
        verificationStatus: stored.verification?.status ?? null,
        anchoredCommitment: stored.verification?.anchoredCommitment ?? null,
      }
    : null;

  const riskScore = result ? result.riskScore : null;

  /**
   * Summary built from what actually happened.
   *
   * Counts published advisory findings (real known vulnerabilities) separately
   * from heuristic pattern matches (static signals), because those are
   * different kinds of evidence and the reader is entitled to know which is
   * which. Says nothing about a "network" — there is none.
   */
  const resultSummary = ((): string => {
    if (!result) return "No result recorded for this scan.";
    const advisories = result.findings.filter((f) => f.kind === "advisory");
    const heuristics = result.findings.filter((f) => f.kind === "heuristic");
    const bits: string[] = [`Risk score ${result.riskScore}/100 under policy ${result.policyVersion}.`];

    if (result.verdict === "block") {
      bits.push("Installation of this exact version is blocked by security policy.");
    } else if (result.verdict === "review") {
      bits.push("Installation is held for human review before execution.");
    } else {
      bits.push("No policy violation was detected in the downloaded artifact.");
    }

    if (advisories.length > 0) {
      const ids = advisories.map((a) => a.source?.id).filter(Boolean).slice(0, 3).join(", ");
      bits.push(
        `${advisories.length} published vulnerabilit${advisories.length === 1 ? "y" : "ies"} affect this exact version (${ids}).`,
      );
    } else if (result.advisories.state === "checked") {
      bits.push("No published advisory matches this exact version.");
    } else {
      bits.push("Advisory lookup did not complete, so the absence of known vulnerabilities is not established.");
    }

    if (heuristics.length > 0) {
      bits.push(`${heuristics.length} static code pattern${heuristics.length === 1 ? "" : "s"} matched in the source.`);
    }

    if (consensus) {
      bits.push(
        `Three locally signed scanner roles reached ${consensus.result.toUpperCase()} at quorum ${consensus.quorumMet}/${consensus.quorumRequired}.`,
      );
    }
    if (attestation?.confirmed) {
      bits.push("The result is anchored and confirmed on Solana Devnet.");
    }

    return bits.join(" ");
  })();

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
              {/* Show what the registry actually resolved, not just what was typed. */}
              {result ? result.resolvedVersion : scan.version}
            </span>
          </div>
          <p className="mono-body mt-2 text-[12px] text-label">
            npm / {scan.packageName} / {result ? result.resolvedVersion : scan.version}
            {result && result.resolvedVersion !== scan.version ? (
              <span className="ml-1.5">· requested {scan.version}</span>
            ) : null}
          </p>
          {isLegacy ? (
            <div className="mt-3">
              <RescanButton scanId={scan.id} />
            </div>
          ) : null}
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
      {/*
        `devnetSupported` is only the pre-probe hint shown before the client has
        queried the wallet. It was hardcoded to `true`, which claimed a
        capability no server had verified. It is now derived from the cluster the
        deployment is actually configured for; the client then replaces it with
        a live probe result in ReportTabs.
      */}
      <ReportTabs
        scan={scan}
        threatCount={scan.findings.length}
        consensus={reportConsensus}
        attestation={reportAttestation}
        devnetSupported={SOLANA_CLUSTER === "devnet"}
      />

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
                  ? "This scan is queued. The package has not been downloaded or inspected yet, so no verdict exists."
                  : scan.status === "error"
                    ? "The scan did not complete. Nothing is known about this package and it must not be treated as safe. Re-run it from the Scanner page."
                    : resultSummary}
              </p>
              {result && result.verdict === "block" ? (
                <p className="mono-body mt-2 text-[11.5px] leading-[1.6] text-label">
                  A block is a policy decision to refuse installation of this exact version. It is not a claim that the package is malware.
                </p>
              ) : null}
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
              {consensus ? (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="dz-overline">Quorum</span>
                    <span className="mono-body text-[11px] text-ink">
                      {consensus.quorumMet}/{consensus.quorumRequired}
                    </span>
                    <span className="dz-overline">Result</span>
                    <span className="mono-body text-[11px] uppercase text-ink">
                      {consensus.result}
                    </span>
                    <span className="dz-overline">Policy</span>
                    <span className="mono-body text-[11px] text-label">
                      {consensus.policyVersion}
                    </span>
                  </div>
                  <p className="mono-body mt-2 text-[11px] leading-[1.6] text-label">
                    {consensus.rationale}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {consensus.votes.map((v) => (
                      <li
                        key={v.publicKeyHex}
                        className="mono-body flex items-baseline gap-2 text-[10.5px] text-label"
                      >
                        <span className="uppercase text-ink">{v.verdict}</span>
                        <span className="truncate">{v.role}</span>
                        <span className="ml-auto shrink-0 text-faint">
                          {v.publicKeyHex.slice(0, 12)}…
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10.5px] leading-[1.55] text-faint">
                    Three analytical modules run on one machine under one operator.
                    Their signatures prove internal consistency and tamper-evidence,
                    not independent verification or decentralisation.
                  </p>
                </div>
              ) : (
                <p className="mono-body mt-3 text-[11px] text-label">
                  No signed scanner votes exist for this scan. This record predates
                  attestation, so no consensus is claimed. Rescan to produce one.
                </p>
              )}
            </Panel>
          </div>

          {/* Threats + attestation */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KeyThreats findings={scan.findings} resolution={result} />

            <Panel title="On-chain Attestation" icon={<AttestationIcon />}>
              <dl>
                <KvRow label="Network">
                  {/* Previously fell back to a literal "Solana Devnet", which
                      displayed a transaction cluster for scans that were never
                      anchored. An unanchored scan has no network to report. */}
                  {attestation ? (
                    attestation.cluster
                  ) : (
                    <span className="text-label">Not anchored</span>
                  )}
                </KvRow>
                <KvRow label="Mechanism">
                  {attestation ? (
                    <span className="text-[11.5px] leading-[1.5]">{attestation.mechanismLabel}</span>
                  ) : (
                    "—"
                  )}
                </KvRow>
                <KvRow label="Transaction" mono>
                  {attestation?.transactionSignature ? (
                    <a
                      href={attestation.explorerUrl ?? explorerTxUrl(attestation.transactionSignature)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-4 hover:text-[#155534]"
                    >
                      {attestation.transactionSignature.slice(0, 4)}…
                      {attestation.transactionSignature.slice(-4)}
                    </a>
                  ) : (
                    <span className="text-label">Not anchored</span>
                  )}
                </KvRow>
                <KvRow label="Slot" mono>
                  {attestation?.slot ?? "—"}
                </KvRow>
                <KvRow label="Commitment" mono>
                  {attestation?.commitmentHash ? (
                    <CopyValue
                      value={attestation.commitmentHash}
                      display={`${attestation.commitmentHash.slice(0, 12)}…`}
                      label="Copy commitment hash"
                    />
                  ) : (
                    <span className="text-label">—</span>
                  )}
                </KvRow>
                <KvRow label="Status">
                  <AttestationStatusLabel attestation={attestation} />
                </KvRow>
              </dl>
              {attestation?.error ? (
                <p className="mono-body mt-3 text-[11px] leading-[1.6] text-[#6B440B]">
                  {attestation.error}
                </p>
              ) : null}
              {attestation?.confirmed ? (
                <a
                  href={attestation.explorerUrl ?? explorerTxUrl(attestation.transactionSignature ?? "")}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="dz-btn-ghost mt-3 w-full"
                >
                  View on Explorer
                  <span aria-hidden="true">↗</span>
                </a>
              ) : null}
              {stored ? (
                <a
                  href={`/api/attestations/${scan.id}/bundle`}
                  className="dz-btn-ghost mt-2 w-full"
                >
                  Export proof bundle
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
              <KvRow label="Publisher">{result?.metadata?.publisher ?? NA}</KvRow>
              <KvRow label="First Published">
                {result?.metadata?.publishedAt ? formatDate(result.metadata.publishedAt) : NA}
              </KvRow>
              <KvRow label="Last Updated">
                {result?.metadata?.modifiedAt ? formatDate(result.metadata.modifiedAt) : NA}
              </KvRow>
              <KvRow label="License">{result?.metadata?.license ?? NA}</KvRow>
              <KvRow label="Package Size">
                {result?.metadata?.unpackedSize
                  ? `${(result.metadata.unpackedSize / 1024).toFixed(0)} KB unpacked`
                  : result
                    ? `${(result.tarballBytes / 1024).toFixed(0)} KB tarball`
                    : NA}
              </KvRow>
              <KvRow label="Files">
                {result?.metadata?.fileCount ?? result?.fileCount ?? NA}
              </KvRow>
              <KvRow label="Repository">
                {result?.metadata?.repository && repositoryUrl(result.metadata.repository) ? (
                  <a
                    href={repositoryUrl(result.metadata.repository) ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4 hover:text-[#155534]"
                  >
                    {result.metadata.repository.replace(/^git\+/, "")}
                  </a>
                ) : (
                  NA
                )}
              </KvRow>
              {result?.metadata?.description ? (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <p className="dz-overline">Description</p>
                  <p className="mono-body mt-1.5 text-[11.5px] leading-[1.6] text-label">
                    {result.metadata.description}
                  </p>
                </div>
              ) : null}
            </dl>
          </Panel>

          <CodeEvidence
            evidence={
              result?.findings.flatMap((f) =>
                f.evidence
                  .filter((e) => e.file.endsWith(".js") || e.file.endsWith(".json"))
                  .map((e) => ({ file: `${f.ruleId} · ${e.file}`, lines: [e.snippet] })),
              )[0]
            }
          />

          {/*
            Real scan provenance. Every value here comes from the scanner run
            that produced this record. Fields the scanner did not measure stay a
            dash rather than being filled with something plausible.
          */}
          <Panel title="Scan Result" icon={<MetadataIcon />}>
            <dl>
              <KvRow label="Status">
                {result ? (
                  <span className="text-ink">{result.verdict.toUpperCase()}</span>
                ) : scan.phase === "error" ? (
                  <span className="text-[#8A2C23]">ERROR</span>
                ) : (
                  <span className="text-label">
                    {isLegacy ? "UNRESOLVED (LEGACY)" : (scan.phase ?? "queued").toUpperCase()}
                  </span>
                )}
              </KvRow>
              <KvRow label="Scanner" mono>
                {result ? result.scannerVersion : "—"}
              </KvRow>
              <KvRow label="Policy" mono>
                {result ? result.policyVersion : "—"}
              </KvRow>
              <KvRow label="Artifact SHA-256" mono>
                {result ? (
                  <CopyValue value={result.artifactSha256} display={`${result.artifactSha256.slice(0, 12)}…`} label="Copy artifact hash" />
                ) : (
                  "—"
                )}
              </KvRow>
              <KvRow label="Registry" mono>
                {result ? result.registry.replace("https://", "") : "—"}
              </KvRow>
              <KvRow label="Tarball Size" mono>
                {result ? `${(result.tarballBytes / 1024).toFixed(1)} KB` : "—"}
              </KvRow>
              <KvRow label="Files Read" mono>
                {result ? result.fileCount : "—"}
              </KvRow>
              <KvRow label="Duration" mono>
                {result ? `${result.durationMs} ms` : "—"}
              </KvRow>
              <KvRow label="Advisories">
                {result
                  ? result.advisories.state === "checked"
                    ? `${result.advisories.vulnerabilities.length} known`
                    : "unavailable"
                  : "—"}
              </KvRow>
              <KvRow label="Created At">{scanDate}</KvRow>
            </dl>

            {result?.rationale ? (
              <p className="mono-body mt-3 border-t border-line-soft pt-3 text-[11px] leading-[1.6] text-label">
                <span className="text-ink">Policy rationale: </span>
                {result.rationale}
              </p>
            ) : null}
          </Panel>

          {result && result.dependencies.direct.length > 0 ? (
            <Panel title="Direct Dependencies">
              <p className="mono-body mb-2 text-[11px] leading-[1.5] text-label">
                {result.dependencies.note}
              </p>
              <ul className="flex flex-col gap-1">
                {result.dependencies.direct.map((d) => (
                  <li key={d.name} className="mono-body flex justify-between gap-3 text-[11.5px]">
                    <span className="truncate text-ink">{d.name}</span>
                    <span className="shrink-0 text-label">{d.range}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/* Small inline icons so the panel headings match the reference exactly. */
/**
 * Honest attestation status.
 *
 * Says exactly what the stored record says. A recorded but unconfirmed
 * transaction is never rendered as attested, and a missing transaction is
 * never rendered as pending success.
 */
function AttestationStatusLabel({
  attestation,
}: {
  attestation: {
    status: string;
    confirmed: boolean;
    transactionSignature: string | null;
  } | null;
}) {
  if (!attestation) {
    return <span className="text-label">Not attested — rescan to create a proof</span>;
  }
  if (attestation.confirmed && attestation.transactionSignature) {
    return <span className="text-[#155534]">Confirmed on Solana Devnet</span>;
  }
  if (attestation.status === "failed") {
    return <span className="text-[#8A2C23]">Failed — not confirmed</span>;
  }
  return <span className="text-[#6B440B]">Not confirmed on Solana Devnet</span>;
}

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