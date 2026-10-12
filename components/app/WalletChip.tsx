"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";

import { useWalletState } from "@/components/app/WalletRequirement";
import type { DetectedWallet } from "@/lib/wallet-providers";
// Client component: imports the client-safe Explorer helper, not `lib/config`,
// which resolves DATA_DIR from node:os at module scope.
import { explorerAddressUrl } from "@/lib/explorer";

/** Human label for a Wallet Standard chain identifier. */
function chainLabel(chain: string): string {
  if (chain === "solana:devnet") return "Devnet";
  if (chain === "solana:mainnet") return "Mainnet";
  return chain.replace("solana:", "");
}

function WalletIcon({ wallet }: { wallet: DetectedWallet }) {
  if (wallet.icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={wallet.icon} alt="" className="size-5 shrink-0 rounded" />
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-[#EDEBE1]">
      <Wallet aria-hidden="true" strokeWidth={1.7} className="size-3" />
    </span>
  );
}

/**
 * Wallet control.
 *
 * Visual language is unchanged from the rest of the console — bone surfaces,
 * hairline borders, Instrument Sans labels, IBM Plex Mono for the address.
 * The behaviour is what changed: the control is never disabled, it discovers
 * both Wallet Standard and legacy providers, and it distinguishes a declined
 * request from a locked wallet from a missing extension.
 */
export function WalletChip() {
  // Reads the single shared instance from the console provider. Calling
  // `useWallet()` here instead would start a second, independent discovery loop
  // whose `register()` callback overwrote the provider's.
  const {
    wallets,
    phase,
    error,
    errorKind,
    connected,
    connect,
    disconnect,
    rediscover,
    clearError,
    ready,
    noProviderSupport,
  } = useWalletState();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onConnect = async (wallet: DetectedWallet) => {
    setOpen(false);
    await connect(wallet);
  };

  /* ---------------------------------------------------------------- connected */

  if (connected) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Wallet connected: ${connected.walletName} ${connected.shortAddress}`}
          className="flex h-10 items-center gap-2.5 rounded-[8px] border border-line-soft bg-white pl-2 pr-2.5 text-[13px] transition-colors hover:border-line"
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-[#DCEBB4] text-[10px] font-bold text-[#3F4A12]"
          >
            {connected.address.slice(0, 2).toUpperCase()}
          </span>
          <span className="mono-body">{connected.shortAddress}</span>
          {!connected.verified ? (
            <span
              title="Address could not be confirmed on Devnet."
              className="text-[#8A2C23]"
            >
              <AlertTriangle aria-hidden="true" strokeWidth={1.9} className="size-3.5" />
              <span className="sr-only">Unverified on Devnet</span>
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" strokeWidth={1.8} className="size-3.5 text-label" />
        </button>

        {open ? (
          <div
            role="menu"
            aria-label="Wallet"
            className="absolute right-0 z-50 mt-2 w-80 rounded-[10px] border border-line-soft bg-white p-3 shadow-[0_8px_24px_rgba(23,24,22,0.08)]"
          >
            <div className="flex items-center gap-2">
              <Check
                aria-hidden="true"
                strokeWidth={2}
                className={`size-4 shrink-0 ${connected.verified ? "text-[#155534]" : "text-[#8A2C23]"}`}
              />
              <p className="text-[13px] font-semibold text-ink">Connected</p>
            </div>

            <p className="mono-label mt-2.5 text-[10.5px] text-label">{connected.walletName}</p>
            <p className="mono-body mt-1.5 text-[12px] break-all text-ink">{connected.address}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {connected.verified ? (
                <p className="mono-body text-[11.5px] text-label">
                  {connected.balanceSol === null
                    ? "On Devnet · balance unavailable"
                    : `${connected.balanceSol} SOL on Devnet`}
                </p>
              ) : (
                <p className="mono-body text-[11.5px] text-[#8A2C23]">
                  Not found on Devnet — this address may not exist on this cluster.
                </p>
              )}
              {connected.chains.length > 0 ? (
                <p className="mono-label text-[10.5px] text-label">
                  {connected.chains.map(chainLabel).join(" · ")}
                </p>
              ) : null}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(connected.address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    /* clipboard blocked — the address is selectable above */
                  }
                }}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-line-soft text-[13px] font-medium text-ink transition-colors hover:bg-[#F3F1E8]"
              >
                {copied ? (
                  <Check aria-hidden="true" strokeWidth={2} className="size-3.5 text-[#155534]" />
                ) : (
                  <Copy aria-hidden="true" strokeWidth={1.7} className="size-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={explorerAddressUrl(connected.address)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-line-soft text-[13px] font-medium text-ink transition-colors hover:bg-[#F3F1E8]"
              >
                Explorer
                <ExternalLink aria-hidden="true" strokeWidth={1.7} className="size-3.5" />
              </a>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void disconnect();
                setOpen(false);
              }}
              className="mt-2 h-11 w-full rounded-[7px] border border-line-soft text-[13px] font-medium text-ink transition-colors hover:bg-[#F3F1E8]"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ------------------------------------------------------------- disconnected */

  const label = phase === "connecting" ? "Connecting…" : "Connect Wallet";
  // The alert must survive the menu closing and reopening after a failed
  // attempt, so it is derived from state that outlives the `open` flag rather
  // than being cleared when the menu unmounts.
  const showError = phase === "error" && Boolean(error);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // Never disabled: even with no provider detected the control must stay
        // usable so the user can reach the guidance and retry.
        disabled={false}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-10 items-center gap-2 rounded-[8px] border border-line-soft bg-white px-3.5 text-[13px] font-medium text-ink transition-colors hover:border-line"
      >
        {phase === "connecting" ? (
          <Loader2 aria-hidden="true" strokeWidth={1.8} className="size-4 animate-spin" />
        ) : showError ? (
          <AlertTriangle aria-hidden="true" strokeWidth={1.8} className="size-4 text-[#8A2C23]" />
        ) : (
          <Wallet aria-hidden="true" strokeWidth={1.7} className="size-4" />
        )}
        {label}
      </button>

      {showError && !open ? (
        <p
          role="status"
          className="mono-body pointer-events-none absolute top-full right-0 z-40 mt-1.5 w-72 text-right text-[11px] leading-[1.4] text-[#8A2C23]"
        >
          {error}
        </p>
      ) : null}

      {open ? (
        <div
          role="menu"
          aria-label="Connect a wallet"
          className="absolute right-0 z-50 mt-2 w-72 rounded-[10px] border border-line-soft bg-white p-2 shadow-[0_8px_24px_rgba(23,24,22,0.08)]"
        >
          {showError ? (
            <div
              role="alert"
              className="mb-2 flex items-start gap-2 rounded-[7px] bg-[#FBE9E6] px-2.5 py-2"
            >
              {errorKind === "locked" ? (
                <Lock aria-hidden="true" strokeWidth={1.8} className="mt-px size-3.5 shrink-0 text-[#8A2C23]" />
              ) : (
                <X aria-hidden="true" strokeWidth={2} className="mt-px size-3.5 shrink-0 text-[#8A2C23]" />
              )}
              <p className="mono-body text-[11.5px] leading-[1.5] text-[#8A2C23]">{error}</p>
            </div>
          ) : null}

          {!ready ? (
            <p className="mono-body flex items-center gap-2 px-2.5 py-3 text-[12px] text-label">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Looking for wallets…
            </p>
          ) : wallets.length > 0 ? (
            <ul>
              {wallets.map((wallet) => (
                <li key={wallet.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void onConnect(wallet)}
                    className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2.5 text-left text-[13px] text-ink transition-colors hover:bg-[#F3F1E8]"
                  >
                    <WalletIcon wallet={wallet} />
                    <span className="min-w-0 flex-1 truncate">{wallet.name}</span>
                    {wallet.chains.length > 0 ? (
                      <span className="mono-label shrink-0 text-[9px] text-label">
                        {wallet.chains.map(chainLabel).join(" · ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-2.5 py-2">
              <p className="text-[13px] font-medium text-ink">
                {noProviderSupport ? "No wallet detected" : "No connectable wallet"}
              </p>
              <p className="mono-body mt-1.5 text-[12px] leading-[1.6] text-label">
                {noProviderSupport
                  ? "This browser exposes no wallet API. Install the Phantom extension, unlock it, then re-check."
                  : "A wallet is installed but has not connected to this page. Unlock it, refresh, then re-check."}
              </p>
            </div>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => rediscover()}
            className="mt-1 flex w-full items-center gap-2 border-t border-line-soft px-2.5 pt-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-[#F3F1E8]"
          >
            <RefreshCw aria-hidden="true" strokeWidth={1.8} className="size-3.5" />
            Re-check for wallets
          </button>

          {showError ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => clearError()}
              className="mt-1 flex w-full items-center justify-center gap-1.5 border-t border-line-soft px-2.5 pt-2.5 text-[12px] font-medium text-label transition-colors hover:text-ink"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
