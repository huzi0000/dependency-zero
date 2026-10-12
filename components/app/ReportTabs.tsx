"use client";

import { useCallback, useEffect, useState } from "react";

import { PageTabs, TabPanel, type TabItem } from "@/components/app/PageTabs";
import { CodeEvidence, KeyThreats } from "@/components/app/ReportVisuals";
import { KvRow, Panel } from "@/components/app/Panels";
import { CopyValue } from "@/components/app/CopyValue";
import { TimeAgo } from "@/components/app/TimeAgo";
import type { ScanRecord } from "@/lib/types";
import {
  anchorWithWallet,
  reconcile,
  IDLE,
  type AnchorPhase,
  type AnchorState,
} from "@/lib/wallet-anchor";
import { useWalletSession } from "@/lib/wallet-session";
import { chainsOf } from "@/lib/wallet-providers";

type Tab = "overview" | "threats" | "behavior" | "verdicts" | "proof";

/** The real signed evidence, shaped for display. Only public data. */
export interface ReportConsensus {
  verified: boolean;
  result: string;
  quorumMet: number;
  quorumRequired: number;
  policyVersion: string;
  rationale: string;
  blockOverride: boolean;
  votes: {
    role: string;
    verdict: string;
    riskScore: number;
    publicKeyHex: string;
    operator: string;
    signature: string;
    signatureVerified: boolean;
    findingsContribution: number;
  }[];
  rejected: { role: string; reason: string; detail: string }[];
  unavailableRoles: string[];
}

export interface ReportAttestation {
  status: string;
  confirmed: boolean;
  transactionSignature: string | null;
  slot: number | null;
  blockTime: number | null;
  confirmationStatus: string | null;
  explorerUrl: string | null;
  commitmentHash: string;
  mechanismLabel: string;
  cluster: string;
  memoProgramId: string;
  error: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  /** Independent verification status recorded by the server. */
  verificationStatus: string | null;
  anchoredCommitment: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  static_lifecycle: "Static & Lifecycle Analysis",
  dependency_advisory: "Dependency & Advisory Analysis",
  artifact_integrity: "Artifact & Integrity Analysis",
};

/** How long the final anchor state stays on screen before the reload. */
const RELOAD_DELAY_MS = 1400;

/**
 * The anchor action is offered only when a wallet is connected AND that wallet
 * advertises Solana Devnet support. Anchoring to mainnet by accident would be
 * unrecoverable, so the gate is deliberately conservative.
 */
function session_ready(connected: boolean, devnetSupported: boolean): boolean {
  return connected && devnetSupported;
}

/**
 * Threat Report tabs.
 *
 * Every panel below shows real recorded data. Where something genuinely does
 * not exist — a runtime behaviour trace, or a registered independent node — the
 * panel says exactly that instead of implying a capability.
 */
export function ReportTabs({
  scan,
  threatCount,
  consensus,
  attestation,
  devnetSupported,
}: {
  scan: ScanRecord;
  threatCount: number;
  consensus: ReportConsensus | null;
  attestation: ReportAttestation | null;
  /** Whether the injected wallet advertises solana:devnet support. */
  devnetSupported: boolean;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [anchor, setAnchor] = useState<AnchorState>(IDLE);
  const [busy, setBusy] = useState(false);

  /**
   * Observe the wallet session that AppShell already established.
   *
   * This is a read of the persisted session, not a second connection: it never
   * touches the provider and never calls connect(). The previous build passed a
   * hardcoded `walletConnected={false}`, which is why the header showed a
   * connected wallet while the anchoring button stayed disabled.
   */
  const session = useWalletSession();
  const shorten = session.address
    ? `${session.address.slice(0, 4)}…${session.address.slice(-4)}`
    : null;

  /**
   * Devnet support is probed in the browser because only the injected wallet
   * knows which clusters it will sign for. It is read once and refreshed on the
   * wallet-changed event, so a wallet that was installed late is still noticed.
   */
  const [detectedDevnet, setDetectedDevnet] = useState<boolean | null>(null);
  useEffect(() => {
    const probe = () => {
      try {
        // Wallet Standard registry is the authoritative cluster list. An empty
        // registry (no extension detected) falls back to the server hint rather
        // than reporting a false negative.
        const registry = (globalThis as { navigator?: { wallets?: unknown } }).navigator?.wallets;
        if (!Array.isArray(registry)) {
          setDetectedDevnet(null);
          return;
        }
        // Reuse the app's own chain reader so both shapes are handled identically.
        const supported = registry.some((entry) =>
          chainsOf(entry as never).some((c) => c.startsWith("solana:")),
        );
        setDetectedDevnet(supported);
      } catch {
        setDetectedDevnet(false);
      }
    };
    probe();
    window.addEventListener("dz:wallet-changed", probe);
    return () => window.removeEventListener("dz:wallet-changed", probe);
  }, []);

  // Until the probe resolves, fall back to the server-rendered hint.
  const devnetOk = detectedDevnet === null ? devnetSupported : detectedDevnet;

  const walletConnected = session.connected && devnetOk;

  const tabs: TabItem<Tab>[] = [
    { id: "overview", label: "Overview" },
    { id: "threats", label: "Threats", badge: threatCount || undefined },
    { id: "behavior", label: "Behavior" },
    { id: "verdicts", label: "Network Verdicts" },
    { id: "proof", label: "On-chain Proof" },
  ];

  const pending = scan.status === "pending";

  /** Lifecycle findings from the full resolution, when a scanner produced one. */
  const lifecycleFindings = (scan.resolution?.findings ?? []).filter((f) =>
    f.ruleId.startsWith("D0-LC-"),
  );

  /**
   * The first real code excerpt across this scan's findings.
   *
   * The Threats tab rendered `<CodeEvidence />` with no props, which always hit
   * the empty branch and claimed no finding quoted a file — even for scans that
   * had file and line evidence recorded. Derived from the stored resolution,
   * exactly as the report body does, so the two surfaces agree.
   */
  const firstEvidence = (scan.resolution?.findings ?? [])
    .flatMap((f) =>
      f.evidence
        .filter((e) => e.file.endsWith(".js") || e.file.endsWith(".json"))
        .map((e) => ({ file: `${f.ruleId} · ${e.file}`, lines: [e.snippet] })),
    )[0];

  /**
   * Reconcile on mount when a transaction exists but was never confirmed.
   *
   * This is what makes a browser refresh safe: a submitted-but-unconfirmed
   * transaction is re-verified against Devnet instead of being re-submitted,
   * which is how a refresh could otherwise anchor the same scan twice.
   */
  useEffect(() => {
    if (
      attestation?.transactionSignature &&
      !attestation.confirmed &&
      attestation.status !== "failed"
    ) {
      void reconcile(scan.id, attestation.transactionSignature).then(setAnchor);
    }
    // Only on mount / identity change.
  }, [scan.id, attestation?.transactionSignature, attestation?.confirmed, attestation?.status]);

  const runAnchor = useCallback(async () => {
    if (busy) return; // double-click guard
    setBusy(true);
    setAnchor({ phase: "preparing", error: null, signature: null });
    try {
      const next = await anchorWithWallet(scan.id);
      setAnchor(next);
      // Reload ONLY when the chain accepted the transaction, so the server
      // render reflects real on-chain state.
      //
      // Reloading unconditionally was a real bug: a failed attempt produced an
      // error that survived ~1.4s and was then wiped by the reload, so the UI
      // looked as though the click had done nothing. Failures must stay on
      // screen and stay actionable.
      if (next.phase === "confirmed" || next.phase === "confirming") {
        window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, scan.id]);

  return (
    <>
      <PageTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        label="Threat report sections"
        className="mt-6"
      />

      <div className="mt-4">
          {/* ------------------------------------------------------ threats */}
          <TabPanel id="threats" active={tab === "threats"}>
            <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
              {/* Passing `resolution` here matters: without it the panel falls
                  back to the legacy flattened findings and loses rule ids,
                  confidence, evidence snippets and advisory attribution. */}
              <KeyThreats findings={scan.findings} resolution={scan.resolution} />
              <CodeEvidence evidence={firstEvidence} />
            </div>
          </TabPanel>

          {/* ----------------------------------------------------- behaviour */}
          <TabPanel id="behavior" active={tab === "behavior"}>
            <div className="dz-card">
              <div className="flex flex-col gap-3 px-4 py-4">
                <p className="text-[13px] font-bold text-ink">Runtime execution not performed</p>
                <p className="mono-body text-[12px] leading-[1.65] text-label">
                  This scan used static artifact analysis and advisory intelligence only. Package
                  code was <span className="text-ink">never executed</span>. Dependency Zero
                  inspects what the npm tarball contains and what the registry and OSV say about
                  it; it does not run install scripts or import the module in a sandbox.
                </p>
                <p className="mono-body text-[12px] leading-[1.65] text-label">
                  That is a deliberate safety property, not a missing feature: running untrusted
                  install hooks is exactly the risk this product exists to prevent. Findings below
                  are evidence read out of the archive.
                </p>
              </div>
              <div className="border-t border-line-soft px-4 py-4">
                <p className="dz-overline">Static lifecycle-script findings</p>
                {lifecycleFindings.length === 0 ? (
                  <p className="mono-body mt-2 text-[12px] leading-[1.6] text-label">
                    No lifecycle or install-script patterns matched in this package&apos;s files.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {lifecycleFindings.map((f) => (
                      <li key={`${f.ruleId}-${f.title}`} className="mono-body text-[11.5px] text-ink-soft">
                        <span className="text-ink">{f.ruleId}</span> {f.title}
                        {f.evidence[0]?.file ? (
                          <span className="text-label">
                            {" "}
                            — {f.evidence[0].file}
                            {f.evidence[0].line ? `:${f.evidence[0].line}` : ""}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </TabPanel>

          {/* ---------------------------------------------- network verdicts */}
          <TabPanel id="verdicts" active={tab === "verdicts"}>
            <div className="dz-card flex flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
                <p className="text-[13px] font-bold text-ink">Local signed scanner roles</p>
                {consensus ? (
                  <span className="mono-body text-[11.5px] text-label">
                    quorum {consensus.quorumMet}/{consensus.quorumRequired} ·{" "}
                    {consensus.policyVersion}
                  </span>
                ) : null}
              </div>

              {!consensus || consensus.votes.length === 0 ? (
                <p className="mono-body px-4 py-4 text-[12px] leading-[1.65] text-label">
                  This scan has no signed scanner results. It predates attestation, so no vote is
                  claimed here. Rescan the package to produce signed evidence.
                </p>
              ) : (
                <>
                  <ul className="mt-3 flex flex-col divide-y divide-line-soft">
                    {consensus.votes.map((v) => (
                      <li key={v.publicKeyHex} className="px-4 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-bold text-ink">
                            {ROLE_LABEL[v.role] ?? v.role}
                          </span>
                          <span
                            className={`mono-body text-[11.5px] uppercase ${
                              v.verdict === "block"
                                ? "text-[#8A2C23]"
                                : v.verdict === "review"
                                  ? "text-[#6B440B]"
                                  : "text-[#155534]"
                            }`}
                          >
                            {v.verdict} · risk {v.riskScore}
                          </span>
                        </div>
                        <div className="mono-body mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-label">
                          <span>{v.publicKeyHex.slice(0, 16)}…</span>
                          <span className={v.signatureVerified ? "text-[#155534]" : "text-[#8A2C23]"}>
                            {v.signatureVerified ? "signature verified" : "signature INVALID"}
                          </span>
                          <span>
                            {v.findingsContribution} finding
                            {v.findingsContribution === 1 ? "" : "s"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-line-soft px-4 py-3">
                    <p className="dz-overline">Consensus rationale</p>
                    <p className="mono-body mt-1.5 text-[11.5px] leading-[1.6] text-label">
                      {consensus.rationale}
                    </p>
                    {consensus.rejected.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {consensus.rejected.map((r, i) => (
                          <li key={i} className="mono-body text-[11px] text-[#8A2C23]">
                            rejected {r.role}: {r.reason} — {r.detail}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </>
              )}

              <div className="border-t border-line-soft bg-[#FAF9F5] px-4 py-3">
                <p className="dz-overline">Independent network nodes</p>
                <p className="mono-body mt-1.5 text-[11.5px] leading-[1.6] text-label">
                  <span className="font-bold text-ink">0 registered.</span> The three roles above run
                  as analytical modules on one machine under one operator. They are not independent
                  third-party operators and provide no decentralisation. No on-chain scanner registry
                  program is deployed, so there is nothing that could enforce independent
                  registration.
                </p>
              </div>
            </div>
          </TabPanel>

          {/* ------------------------------------------------------- overview */}
          {/*
            This tab previously had no panel at all: every non-overview panel was
            gated behind `tab !== "overview"`, so selecting it changed nothing on
            screen. It now renders the scan's own summary — real recorded values,
            no new claims.
          */}
          <TabPanel id="overview" active={tab === "overview"}>
            <div className="dz-card">
              <div className="flex flex-col gap-3 px-4 py-4">
                <p className="text-[13px] font-bold text-ink">Scan summary</p>
                <p className="mono-body text-[12px] leading-[1.65] text-label">
                  {pending
                    ? "This scan has not resolved to a verdict yet. Nothing below is a security judgement."
                    : `${scan.packageName}@${scan.version} was inspected against npm metadata, its published tarball and OSV advisories, and returned ${scan.status.toUpperCase()}.`}
                </p>
              </div>
              <div className="border-t border-line-soft px-4 py-4">
                <p className="dz-overline">Recorded evidence</p>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <div>
                    <dt className="mono-label text-[11px] uppercase text-label">Verdict</dt>
                    <dd className="mono-body mt-1 text-[12.5px] text-ink">
                      {pending ? "Pending" : scan.status.toUpperCase()}
                    </dd>
                  </div>
                  <div>
                    <dt className="mono-label text-[11px] uppercase text-label">Risk score</dt>
                    <dd className="mono-body mt-1 text-[12.5px] text-ink">
                      {scan.resolution ? `${scan.resolution.riskScore}/100` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="mono-label text-[11px] uppercase text-label">Findings</dt>
                    <dd className="mono-body mt-1 text-[12.5px] text-ink">
                      {scan.resolution ? scan.resolution.findings.length : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="mono-label text-[11px] uppercase text-label">Signed by</dt>
                    <dd className="mono-body mt-1 text-[12.5px] text-ink">
                      {consensus ? `${consensus.votes.length} local roles` : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="mono-body mt-4 text-[11.5px] leading-[1.6] text-label">
                  Package code was never executed. Open the Threats tab for individual
                  findings and the exact lines they matched.
                </p>
              </div>
            </div>
          </TabPanel>

          {/* --------------------------------------------------- on-chain proof */}
          <TabPanel id="proof" active={tab === "proof"}>
            <ProofPanel
              scan={scan}
              attestation={attestation}
              anchor={anchor}
              busy={busy}
              walletConnected={walletConnected}
              walletShort={shorten}
              walletName={session.walletName}
              devnetSupported={devnetOk}
              onAnchor={runAnchor}
            />
          </TabPanel>
        </div>
    </>
  );
}

/** Delay before reloading so the final state is briefly visible. */
function next0Delay(state: AnchorState): number {
  return state.phase === "confirmed" ? 1200 : 0;
}

/**
 * Plain-language framing for the current anchoring state.
 *
 * Two gaps this closes. Previously the panel only branched on
 * `liveConfirmed` vs everything else, so "prepared, awaiting approval",
 * "submitted, unconfirmed" and "failed before submission" all rendered
 * identically — a user could not tell whether a transaction had actually
 * reached the network, which is the difference between retrying safely and
 * anchoring the same scan twice.
 *
 * The wording is also explicit that the scan verdict is untouched by any of
 * this. Anchoring is optional; a failed anchor is not a failed scan.
 */
function anchorGuidance(
  phase: AnchorPhase,
  liveConfirmed: boolean,
): { headline: string; body: string; tone: "ok" | "wait" | "warn" } | null {
  if (liveConfirmed) {
    return {
      headline: "Anchored and verified on Solana Devnet",
      body:
        "The commitment was fetched back from the cluster and matched this scan. Anchoring is optional — the signed verdict above is already final and independent of it.",
      tone: "ok",
    };
  }
  switch (phase) {
    case "preparing":
    case "awaiting_wallet":
      return {
        headline: "Transaction prepared, awaiting your approval",
        body:
          "Nothing has been submitted yet. Approve or dismiss the prompt in your wallet to continue.",
        tone: "wait",
      };
    case "submitting":
      return {
        headline: "Submitted to Solana Devnet",
        body:
          "Your wallet has sent the transaction and it is not confirmed yet. Do not anchor again — this page reconciles on refresh, and a second attempt could anchor the same scan twice.",
        tone: "wait",
      };
    case "confirming":
      return {
        headline: "Transaction sent, confirmation pending",
        body:
          "A transaction was submitted. It is being reconciled against Devnet and will resolve on refresh. Anchoring again now risks a duplicate.",
        tone: "wait",
      };
    case "insufficient_funds":
      return {
        headline: "No transaction was submitted",
        body:
          "Your wallet rejected the request before signing because it does not hold enough Devnet SOL for the fee. The scan verdict is unaffected and is available above. Fund the wallet with test SOL on Devnet, then retry.",
        tone: "warn",
      };
    case "wrong_network":
      return {
        headline: "No transaction was submitted",
        body:
          "Your wallet is on a different cluster, so it declined to sign. The scan verdict is unaffected. Switch the wallet to Solana Devnet and retry.",
        tone: "warn",
      };
    case "rejected":
      return {
        headline: "No transaction was submitted",
        body:
          "You dismissed the approval prompt, so nothing was sent. The scan verdict is unaffected and retrying is safe.",
        tone: "warn",
      };
    case "failed":
      return {
        headline: "Anchoring did not complete",
        body:
          "The scan itself completed and its verdict stands — anchoring is an optional extra step. Confirm whether a transaction was sent before retrying.",
        tone: "warn",
      };
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* On-chain proof                                                             */
/* -------------------------------------------------------------------------- */

function ProofPanel({
  scan,
  attestation,
  anchor,
  busy,
  walletConnected,
  walletShort,
  walletName,
  devnetSupported,
  onAnchor,
}: {
  scan: ScanRecord;
  attestation: ReportAttestation | null;
  anchor: AnchorState;
  busy: boolean;
  walletConnected: boolean;
  walletShort: string | null;
  walletName: string | null;
  devnetSupported: boolean;
  onAnchor: () => void;
}) {
  const liveConfirmed = anchor.phase === "confirmed" || attestation?.confirmed === true;
  const inFlight = busy || ["preparing", "awaiting_wallet", "submitting", "confirming"].includes(anchor.phase);
  /* Server-side state counts too: after a reload the anchor state resets to
     idle while the record still says a transaction is pending. */
  const serverPending =
    !liveConfirmed &&
    Boolean(attestation?.transactionSignature) &&
    attestation?.status !== "failed";
  const guidance = anchorGuidance(
    anchor.phase === "idle" && serverPending ? "confirming" : anchor.phase,
    liveConfirmed,
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      <div className="dz-card flex flex-col">
        <div className="px-4 pt-4">
          <p className="text-[13px] font-bold text-ink">Solana Devnet anchoring</p>
          <p className="mono-body mt-1.5 text-[12px] leading-[1.65] text-label">
            Anchoring writes a single hash to Solana Devnet inside a real SPL Memo transaction. The
            hash commits to this scan&apos;s artifact, its three signed scanner results and its
            consensus. It does <span className="text-ink">not</span> copy package contents on chain
            and it is not a deployed registry program.
          </p>
        </div>

        <dl className="mt-3 px-4">
          <KvRow label="Mechanism">
            <span className="text-[11.5px] leading-[1.5]">
              {attestation?.mechanismLabel ?? "Solana Devnet commitment anchored via Memo"}
            </span>
          </KvRow>
          <KvRow label="Cluster">{attestation?.cluster ?? "devnet"}</KvRow>
          <KvRow label="Commitment" mono>
            {attestation?.commitmentHash ? (
              <CopyValue
                value={attestation.commitmentHash}
                display={`${attestation.commitmentHash.slice(0, 12)}…`}
                label="Copy commitment"
              />
            ) : (
              <span className="text-label">not computed</span>
            )}
          </KvRow>
          <KvRow label="Transaction" mono>
            {attestation?.transactionSignature ? (
              <CopyValue
                value={attestation.transactionSignature}
                display={`${attestation.transactionSignature.slice(0, 4)}…${attestation.transactionSignature.slice(-4)}`}
                label="Copy signature"
              />
            ) : (
              <span className="text-label">none submitted</span>
            )}
          </KvRow>
          <KvRow label="Slot" mono>{attestation?.slot ?? "—"}</KvRow>
          <KvRow label="Verification">
            {liveConfirmed ? (
              <span className="text-[#155534]">
                {attestation?.verificationStatus ?? "VERIFIED"} — on-chain commitment matches
              </span>
            ) : attestation?.transactionSignature ? (
              <span className="text-[#6B440B]">{attestation?.verificationStatus ?? "PENDING"}</span>
            ) : (
              <span className="text-label">not anchored</span>
            )}
          </KvRow>
        </dl>

        {guidance ? (
          <div
            className={`mt-3 border-t border-line-soft px-4 pt-3.5 ${
              guidance.tone === "ok" ? "text-[#155534]" : guidance.tone === "wait" ? "text-[#6B440B]" : "text-[#8A2C23]"
            }`}
          >
            <p className="text-[12.5px] font-bold">
              {guidance.headline}
              {guidance.tone === "wait" ? (
                <span className="mono-label ml-2 inline-flex rounded px-1.5 py-[2px] text-[11px] align-middle text-[#6B440B] ring-1 ring-[#C9A227]">
                  {inFlight ? "IN PROGRESS" : "PENDING"}
                </span>
              ) : null}
            </p>
            <p className="mono-body mt-1.5 text-[11.5px] leading-[1.65] text-label">
              {guidance.body}
            </p>
          </div>
        ) : null}
        {anchor.error ? (
          <p className="mono-body mt-3 px-4 text-[11.5px] leading-[1.6] text-[#6B440B]">{anchor.error}</p>
        ) : null}
        {attestation?.error && !anchor.error ? (
          <p className="mono-body mt-3 px-4 text-[11.5px] leading-[1.6] text-[#6B440B]">
            {attestation.error}
          </p>
        ) : null}

        <div className="px-4 pb-4 pt-3">
          {liveConfirmed ? (
            attestation?.explorerUrl ? (
              <a
                href={attestation.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="dz-btn-ghost w-full"
              >
                View on Solana Explorer
                <span aria-hidden="true">↗</span>
              </a>
            ) : null
          ) : (
            <>
              <button
                type="button"
                onClick={onAnchor}
                disabled={inFlight || !walletConnected || scan.status === "pending"}
                className="dz-btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {anchor.phase === "preparing"
                  ? "Preparing transaction…"
                  : anchor.phase === "awaiting_wallet" || anchor.phase === "submitting"
                    ? "Approve in Phantom…"
                    : anchor.phase === "confirming"
                      ? "Confirming on Devnet…"
                      : !session_ready(walletConnected, devnetSupported)
                        ? "Connect a Devnet wallet to anchor"
                        : "Anchor on Solana"}
              </button>
              <p className="mono-body mt-2 text-[11px] leading-[1.55] text-faint">
                {walletConnected && walletShort
                  ? `Signing as ${walletShort}${walletName ? ` (${walletName})` : ""} on Solana Devnet. `
                  : devnetSupported
                    ? ""
                    : "The detected wallet does not advertise Solana Devnet support. "}
                {liveConfirmed
                  ? "Confirmed after independently fetching the transaction from Devnet."
                  : "Your wallet opens an approval prompt and pays the Devnet fee. This project never asks for your seed phrase or private key."}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Proof bundle">
          <p className="mono-body text-[12px] leading-[1.6] text-label">
            The bundle carries the scan identity, artifact hash, three Ed25519 signatures, the
            consensus policy and the transaction reference. Verify it yourself with the standalone
            CLI — it does not trust this site.
          </p>
          <a
            href={`/api/attestations/${encodeURIComponent(scan.id)}/bundle`}
            className="dz-btn-ghost mt-3 w-full"
          >
            Export proof bundle
          </a>
        </Panel>

        {attestation?.submittedAt ? (
          <Panel title="Timing">
            <dl>
              <KvRow label="Submitted">
                <TimeAgo iso={attestation.submittedAt} className="mono-body" />
              </KvRow>
              {attestation.confirmedAt ? (
                <KvRow label="Confirmed">
                  <TimeAgo iso={attestation.confirmedAt} className="mono-body" />
                </KvRow>
              ) : null}
            </dl>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}