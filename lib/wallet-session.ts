import { useEffect, useState } from "react";

/**
 * Read-only view of the connected wallet session.
 *
 * WHY THIS EXISTS RATHER THAN CALLING useWallet() AGAIN:
 *
 * `useWallet()` performs provider discovery and, on mount, restores a stored
 * session. It is already mounted by AppShell, WalletChip and WalletRequirement.
 * Mounting a fourth copy here would mean a fourth set of wallet event
 * listeners and a second restore pass, which is exactly the kind of duplicate
 * connection state the brief warns against.
 *
 * So this module reads the SAME persisted session key and listens for a plain
 * DOM event. It never touches `window.phantom`, never calls a provider method,
 * and therefore cannot initiate or alter a connection. It is a pure observer.
 *
 * `useWallet` dispatches `dz:wallet-changed` whenever it persists or clears the
 * session, which is what keeps this in sync while the user connects from the
 * header.
 */

export const WALLET_STORAGE_KEY = "dz:wallet";
export const WALLET_CHANGED_EVENT = "dz:wallet-changed";

export interface WalletSession {
  connected: boolean;
  address: string | null;
  walletName: string | null;
}

const NONE: WalletSession = { connected: false, address: null, walletName: null };

/** Minimal base58 sanity check, matching what is actually persisted. */
function isAddress(v: unknown): v is string {
  return typeof v === "string" && v.length >= 32 && v.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(v);
}

function read(): WalletSession {
  if (typeof window === "undefined") return NONE;
  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return NONE;
    const parsed = JSON.parse(raw) as { address?: unknown; walletName?: unknown };
    if (!isAddress(parsed.address)) return NONE;
    return {
      connected: true,
      address: parsed.address,
      walletName: typeof parsed.walletName === "string" ? parsed.walletName : null,
    };
  } catch {
    return NONE;
  }
}

/**
 * Observe the wallet session without touching the provider.
 *
 * Returns the persisted session and re-reads it whenever `useWallet` announces
 * a change, so connecting from the header updates this component immediately
 * without a reload.
 */
export function useWalletSession(): WalletSession {
  const [session, setSession] = useState<WalletSession>(NONE);

  useEffect(() => {
    // Restore on mount, matching what useWallet already established.
    setSession(read());

    const onChange = () => setSession(read());
    window.addEventListener(WALLET_CHANGED_EVENT, onChange);
    // `storage` fires when another tab connects or disconnects.
    window.addEventListener("storage", onChange);

    return () => {
      window.removeEventListener(WALLET_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return session;
}