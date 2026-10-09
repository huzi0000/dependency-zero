"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useWallet, type WalletState } from "@/components/app/useWallet";

/**
 * Mandatory wallet gate.
 *
 * Dependency Zero treats a browser wallet as the required identity for
 * **user-initiated** application actions. Any such action must be gated behind
 * a connected, on-chain-verified wallet.
 *
 * Deliberate carve-out: **autonomous background scanner operations are never
 * gated.** Scanners run off a registered node identity (`ScannerNode.identity`
 * in `lib/store.ts`), not a browser session, so node-to-server ingestion stays
 * available while a user is disconnected. That is why this is an explicit
 * `requireWallet()` opt-in rather than a global redirect — nothing here can
 * accidentally block the ingestion path.
 */
export interface WalletRequirement {
  /** True when a wallet is connected and its address verified on Devnet. */
  satisfied: boolean;
  /** True while a connect request is in flight. */
  pending: boolean;
  /** Human-readable reason the gate is closed, or null when satisfied. */
  reason: string | null;
  /**
   * Runs `action` only when a verified wallet is connected.
   *
   * Returns `{ ok: false }` without running the action when the gate is closed,
   * so a caller cannot accidentally execute an ungated action.
   */
  requireWallet: (action: () => void | Promise<void>) => Promise<{ ok: boolean }>;
}

/**
 * Shared wallet state.
 *
 * There must be exactly ONE `useWallet()` instance in the console. Two
 * instances meant two independent discovery loops, and because React runs
 * child effects before parent effects the second `navigator.wallets.register()`
 * call overwrote the first — so a wallet that announced itself after mount
 * reached the provider's instance but never the one the chip was rendering,
 * and it stayed invisible. Components read the wallet through this context
 * rather than calling the hook themselves.
 */
const WalletStateContext = createContext<WalletState | null>(null);
const WalletRequirementContext = createContext<WalletRequirement | null>(null);

export function WalletRequirementProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WalletState;
}) {
  const requirement = useMemo<WalletRequirement>(() => {
    const satisfied = Boolean(value.connected?.verified);
    const pending = value.phase === "connecting";

    const reason = satisfied
      ? null
      : pending
        ? "Finish the connection request in your wallet."
        : value.phase === "error"
          ? (value.error ?? "The last connection attempt failed.")
          : "Connect a Solana wallet to continue.";

    return {
      satisfied,
      pending,
      reason,
      requireWallet: async (action) => {
        if (!satisfied) return { ok: false };
        await action();
        return { ok: true };
      },
    };
  }, [value]);

  return (
    <WalletStateContext.Provider value={value}>
      <WalletRequirementContext.Provider value={requirement}>
        {children}
      </WalletRequirementContext.Provider>
    </WalletStateContext.Provider>
  );
}

/** Reads the shared wallet state. Throws if used outside the console shell. */
export function useWalletState(): WalletState {
  const ctx = useContext(WalletStateContext);
  if (!ctx) {
    throw new Error("useWalletState must be used inside WalletRequirementProvider.");
  }
  return ctx;
}

/** Reads the mandatory-wallet requirement. */
export function useWalletRequirement(): WalletRequirement {
  const ctx = useContext(WalletRequirementContext);
  if (!ctx) {
    throw new Error("useWalletRequirement must be used inside WalletRequirementProvider.");
  }
  return ctx;
}
