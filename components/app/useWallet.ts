"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WalletStandardWallet } from "@/lib/wallet-standard";
import { initDiagnostics, recordDiag, safeShape } from "@/lib/wallet-diagnostics";
import {
  classifyWalletError,
  discoverWallets,
  isBase58Address,
  shortenAddress,
  type DetectedWallet,
  type WalletErrorKind,
} from "@/lib/wallet-providers";

const STORAGE_KEY = "dz:wallet";

/**
 * How long to keep re-scanning for providers after mount.
 *
 * Extensions inject at `document_start`, but the standard registry resolves
 * asynchronously and a cold extension start can register well after first
 * paint. One `get()` at mount was not enough — a wallet that arrived late was
 * never discovered. Polling is cheap and stops after this window.
 */
const DISCOVERY_WINDOW_MS = 6000;
const POLL_INTERVAL_MS = 400;

export type WalletPhase =
  /** Still scanning for providers. */
  | "discovering"
  /** Providers found, none connected. */
  | "disconnected"
  /** A connect request is in flight. */
  | "connecting"
  /** Connected and verified. */
  | "connected"
  /** The last connect attempt failed; `error` explains why. */
  | "error";

export interface ConnectedWallet {
  walletName: string;
  address: string;
  shortAddress: string;
  /** SOL balance confirmed by the Devnet RPC, or null when unverified. */
  balanceSol: number | null;
  /** Whether the RPC confirm actually succeeded. */
  verified: boolean;
  chains: string[];
}

export interface WalletState {
  wallets: DetectedWallet[];
  phase: WalletPhase;
  error: string | null;
  errorKind: WalletErrorKind | null;
  connected: ConnectedWallet | null;
  /** True once the first discovery pass has completed. */
  ready: boolean;
  /** True when the page exposes no wallet API at all. */
  noProviderSupport: boolean;
  connect: (wallet: DetectedWallet) => Promise<boolean>;
  disconnect: () => Promise<void>;
  /** Re-run discovery on demand, e.g. after installing an extension. */
  rediscover: () => void;
  clearError: () => void;
}

interface Persisted {
  walletName: string;
  address: string;
}

async function verifyOnChain(address: string): Promise<{ sol: number | null; ok: boolean }> {
  try {
    const res = await fetch(`/api/wallet/verify?address=${encodeURIComponent(address)}`, {
      cache: "no-store",
    });
    if (!res.ok) return { sol: null, ok: false };
    const data = (await res.json()) as { ok: boolean; sol: number | null };
    return { sol: data.sol, ok: Boolean(data.ok) };
  } catch {
    return { sol: null, ok: false };
  }
}

/**
 * Wallet connection for Dependency Zero.
 *
 * Speaks both Wallet Standard and the legacy injected providers, keeps
 * re-scanning so a late-registering extension is still found, and verifies the
 * resulting public address against Solana Devnet.
 *
 * **No private key or seed phrase is ever requested, read, stored or sent.**
 * Signing stays entirely inside the wallet extension; the app only reads back a
 * public address.
 */
export function useWallet(): WalletState {
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [phase, setPhase] = useState<WalletPhase>("discovering");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<WalletErrorKind | null>(null);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [ready, setReady] = useState(false);
  const [noProviderSupport, setNoProviderSupport] = useState(false);

  // Guards against setState after unmount and against races between the poll
  // loop and the restore-on-load path.
  const mounted = useRef(true);
  const restoring = useRef(false);

  useEffect(() => {
    mounted.current = true;
    initDiagnostics();
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ---- discovery ------------------------------------------------------- */

  /**
   * Wallets pushed through `register()`. Some registries fire the event before
   * `get()` reflects the new entry, so they are accumulated here and merged in
   * by `discoverWallets` — without this, a wallet that registered after mount
   * was never listed even though the app was told about it.
   */
  const announced = useRef<WalletStandardWallet[]>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await discoverWallets(announced.current);
      if (!mounted.current) return;

      // Compare by identity, not by reference: the poll runs every 400ms and
      // `discoverWallets` builds fresh objects each time, so a naive
      // `setWallets(result.wallets)` would re-render the whole console forever
      // and constantly remount the menu's DOM nodes. Comparing by id + source
      // keeps the rendered output stable while still picking up changes.
      setWallets((previous) => {
        if (previous.length === result.wallets.length) {
          const same = previous.every((w, i) => {
            const next = result.wallets[i];
            return (
              w.id === next.id &&
              w.name === next.name &&
              w.source === next.source &&
              w.chains.join(",") === next.chains.join(",")
            );
          });
          if (same) return previous;
        }
        return result.wallets;
      });
      setNoProviderSupport(!result.registryPresent && result.wallets.length === 0);

      setPhase((current) => {
        // Never clobber an in-flight connect, a live session or an error the
        // user has not dismissed yet.
        if (current === "connecting" || current === "connected" || current === "error") {
          return current;
        }
        return result.wallets.length > 0 ? "disconnected" : "discovering";
      });

      setReady(true);
      return result;
    } catch {
      if (mounted.current) setReady(true);
      return null;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    let unregister: (() => void) | undefined;
    const onSettled = () => void refresh();

    // Pass 1: immediate.
    void (async () => {
      const result = await refresh();
      if (!result) return;

      // Registering the callback catches providers that announce themselves
      // later; the poll covers ones that never fire an event.
      if (navigator.wallets) {
        unregister = navigator.wallets.register((wallet) => {
          announced.current = [...announced.current, wallet];
          void refresh();
        });
      }

      // Keep scanning for a bounded window, then rely on `register`.
      timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
      stopTimer = setTimeout(() => {
        if (timer) clearInterval(timer);
        timer = null;
      }, DISCOVERY_WINDOW_MS);

      // A restored bfcache page can come back with a newly loaded extension.
      window.addEventListener("pageshow", onSettled);
      window.addEventListener("focus", onSettled);
    })();

    return () => {
      if (timer) clearInterval(timer);
      if (stopTimer) clearTimeout(stopTimer);
      unregister?.();
      window.removeEventListener("pageshow", onSettled);
      window.removeEventListener("focus", onSettled);
    };
  }, [refresh]);

  /* ---- session restore -------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;

    const raw = (() => {
      try {
        return window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    if (!raw) {
      setPhase((c) => (c === "discovering" && wallets.length ? "disconnected" : c));
      return;
    }

    let saved: Persisted;
    try {
      saved = JSON.parse(raw) as Persisted;
    } catch {
      clearStored();
      return;
    }

    if (!isBase58Address(saved?.address)) {
      clearStored();
      return;
    }

    restoring.current = true;
    void (async () => {
      try {
        const wallet = wallets.find((w) => w.name === saved.walletName);
        const known = wallet?.existingAddresses.includes(saved.address);

        if (wallet && (known || wallet.existingAddresses.length === 0)) {
          if (!mounted.current) return;
          const { sol, ok } = await verifyOnChain(saved.address);
          if (!mounted.current) return;
          setConnected({
            walletName: wallet.name,
            address: saved.address,
            shortAddress: shortenAddress(saved.address),
            balanceSol: sol,
            verified: ok,
            chains: wallet.chains,
          });
          setPhase("connected");
        } else if (known) {
          // The address belongs to a wallet we have not matched by name — show
          // it anyway rather than silently dropping a valid session.
          const { sol, ok } = await verifyOnChain(saved.address);
          if (!mounted.current) return;
          setConnected({
            walletName: saved.walletName,
            address: saved.address,
            shortAddress: shortenAddress(saved.address),
            balanceSol: sol,
            verified: ok,
            chains: [],
          });
          setPhase("connected");
        } else {
          // Wallet present but no longer authorised (locked, or revoked).
          clearStored();
          setPhase("disconnected");
        }
      } catch {
        clearStored();
      } finally {
        restoring.current = false;
      }
    })();
    // Intentionally keyed on `ready` only: re-running on every `wallets`
    // identity change would re-verify on each poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /* ---- connect / disconnect --------------------------------------------- */

  const connect = useCallback(async (wallet: DetectedWallet): Promise<boolean> => {
    setPhase("connecting");
    setError(null);
    setErrorKind(null);

    try {
      const address = await wallet.connect();
      if (!isBase58Address(address)) {
        throw new Error("Wallet returned an invalid address.");
      }

      // Verify against Devnet before claiming a working connection.
      const { sol, ok } = await verifyOnChain(address);
      if (!mounted.current) return false;

      writeStored({ walletName: wallet.name, address });
      setConnected({
        walletName: wallet.name,
        address,
        shortAddress: shortenAddress(address),
        balanceSol: sol,
        verified: ok,
        chains: wallet.chains,
      });
      setPhase("connected");
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      const { kind, message } = classifyWalletError(cause);
      recordDiag("connect:failed", { error: safeShape({ name: String(cause) }) }, wallet.name, wallet.source);
      clearStored();
      setConnected(null);
      setErrorKind(kind);
      setError(message);
      setPhase("error");
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const active = wallets.find((w) => w.name === connected?.walletName);
    try {
      await active?.disconnect();
    } catch {
      // A wallet may refuse to disconnect; clearing local state is still right.
    }
    clearStored();
    if (mounted.current) {
      setConnected(null);
      setError(null);
      setErrorKind(null);
      setPhase("disconnected");
    }
  }, [connected, wallets]);

  const rediscover = useCallback(() => {
    setPhase("discovering");
    void refresh();
  }, [refresh]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorKind(null);
    setPhase((c) => (c === "error" ? "disconnected" : c));
  }, []);

  return useMemo(
    () => ({
      wallets,
      phase,
      error,
      errorKind,
      connected,
      ready,
      noProviderSupport,
      connect,
      disconnect,
      rediscover,
      clearError,
    }),
    [
      wallets,
      phase,
      error,
      errorKind,
      connected,
      ready,
      noProviderSupport,
      connect,
      disconnect,
      rediscover,
      clearError,
    ],
  );
}

/* -------------------------------------------------------------------------- */

function writeStored(value: Persisted) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private browsing or a full quota — the session simply will not persist */
  }
}

function clearStored() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
