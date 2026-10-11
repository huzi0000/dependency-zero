/**
 * Wallet provider discovery and normalisation.
 *
 * Produces one `DetectedWallet` shape from either Wallet Standard or a legacy
 * injected provider, so the UI never has to care which API a wallet speaks.
 */

import { recordDiag, safeShape } from "@/lib/wallet-diagnostics";
import {
  ACCOUNT_SETTLE_TIMEOUT_MS,
  CONNECT_FEATURE_KEYS,
  DISCONNECT_FEATURE_KEYS,
  EVENTS_FEATURE_KEYS,
} from "@/lib/wallet-phantom";
import type {
  LegacyHost,
  LegacySolanaProvider,
  WalletStandardWallet,
} from "@/lib/wallet-standard";

export interface DetectedWallet {
  /** Stable React key. */
  id: string;
  name: string;
  icon?: string;
  /** Which API this wallet was found through. */
  source: "standard" | "legacy";
  /** Networks the wallet advertises, e.g. ["solana:mainnet", "solana:devnet"]. */
  chains: string[];
  /**
   * Resolves to the base58 public address, or throws with a specific message.
   * Cascades through every source a wallet might use, and waits briefly for an
   * account that arrives via a change event.
   */
  connect: () => Promise<string>;
  disconnect: () => Promise<void>;
  /** Pre-authorised accounts, if the wallet is already authorised. */
  existingAddresses: string[];
}

export interface DetectionResult {
  wallets: DetectedWallet[];
  registryPresent: boolean;
  registryThrew: boolean;
}

export interface DiscoverySnapshot {
  wallets: DetectedWallet[];
  ready: boolean;
  noProviderSupport: boolean;
}

/* -------------------------------------------------------------------------- */
/* Error classification                                                        */
/* -------------------------------------------------------------------------- */

export type WalletErrorKind =
  | "rejected"
  | "locked"
  | "not-authorised"
  | "no-accounts"
  | "unsupported-chain"
  | "no-provider"
  | "unknown";

/**
 * Wallets signal refusal with several different error shapes: the Wallet
 * Standard codes (`WalletNotFoundError` 404, `UserRejectedRequestError` 4001),
 * the older EIP-1193 codes, Phantom's own `WALLET_LOCKED` enum, and plain
 * strings. Normalise them so the UI can say something accurate.
 */
export function classifyWalletError(cause: unknown): {
  kind: WalletErrorKind;
  message: string;
} {
  const raw =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : ((cause as { message?: string } | null)?.message ?? "");
  const code = Number((cause as { code?: unknown } | null)?.code ?? NaN);
  const text = `${raw} ${(cause as { name?: string } | null)?.name ?? ""}`.toLowerCase();

  const rejected =
    code === 4001 ||
    text.includes("user rejected") ||
    text.includes("user denied") ||
    text.includes("rejected the request") ||
    text.includes("requestrejected");

  const locked =
    code === -32002 ||
    text.includes("wallet_locked") ||
    text.includes("locked") ||
    text.includes("unlock your wallet") ||
    text.includes("please unlock");

  const notAuthorised =
    code === -32002 ||
    text.includes("notauthorised") ||
    text.includes("not authorized") ||
    text.includes("not authorised") ||
    text.includes("connect first");

  if (rejected) {
    return { kind: "rejected", message: "Request declined in your wallet." };
  }
  if (locked) {
    return {
      kind: "locked",
      message: "Your wallet is locked. Unlock it, then try again.",
    };
  }
  if (notAuthorised) {
    return {
      kind: "not-authorised",
      message: "Approve the connection request in your wallet to continue.",
    };
  }
  if (text.includes("no account") || text.includes("no-account")) {
    return {
      kind: "no-accounts",
      message:
        "Your wallet approved but returned no account. Unlock it, select an account, then try again.",
    };
  }
  if (text.includes("not implemented") || text.includes("unsupported")) {
    return {
      kind: "unsupported-chain",
      message: "This wallet does not support the Solana network.",
    };
  }
  if (
    text.includes("no wallet") ||
    text.includes("walletnotfound") ||
    text.includes("wallet not found")
  ) {
    return {
      kind: "no-provider",
      message: "No wallet found. Install or unlock a Solana wallet extension.",
    };
  }
  return {
    kind: "unknown",
    message: raw || "The wallet did not complete the request.",
  };
}

/* -------------------------------------------------------------------------- */
/* Address normalisation                                                       */
/* -------------------------------------------------------------------------- */

/** Base58 Solana public key: 32-44 chars, excluding 0, O, I and l. */
export function isBase58Address(value: unknown): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58FromBytes(bytes: Uint8Array): string | null {
  if (bytes.length !== 32) return null;

  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;

  const digits: number[] = [];
  for (let i = leading; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(leading);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/**
 * Unwrap a Solana `PublicKey` instance.
 *
 * This is the single most important case for Phantom: its legacy provider
 * exposes `publicKey` as a class instance with `toBase58()` / `toBytes()`, not
 * a string. Treating it as a plain object yielded `null`, which surfaced to the
 * user as "Wallet returned no account."
 */
function fromPublicKeyLike(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    toBase58?: () => string;
    toBytes?: () => Uint8Array;
    toBuffer?: () => Uint8Array;
  };

  // toBase58 is authoritative and already validated.
  if (typeof candidate.toBase58 === "function") {
    try {
      const encoded = candidate.toBase58();
      if (isBase58Address(encoded)) return encoded;
    } catch {
      /* fall through to the byte representations */
    }
  }
  for (const method of ["toBytes", "toBuffer"] as const) {
    if (typeof candidate[method] === "function") {
      try {
        const bytes = candidate[method]?.();
        if (bytes instanceof Uint8Array) {
          const encoded = base58FromBytes(bytes);
          if (encoded) return encoded;
        }
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

/**
 * Coerce whatever a wallet returns into a base58 public address.
 *
 * Handles every shape seen in the wild:
 *   - a base58 string
 *   - a `PublicKey` instance (`toBase58` / `toBytes`)
 *   - a `Uint8Array(32)`
 *   - `{ address: "<base58>" }`   (Wallet Standard account)
 *   - `{ publicKey: <any of the above> }`  (legacy provider result)
 */
export function normaliseAddress(input: unknown): string | null {
  if (isBase58Address(input)) return input;

  if (input instanceof Uint8Array) return base58FromBytes(input);

  if (input && typeof input === "object") {
    const direct = fromPublicKeyLike(input);
    if (direct) return direct;

    const record = input as { address?: unknown; publicKey?: unknown };

    if (isBase58Address(record.address)) return record.address;

    const fromKey = normaliseAddress(record.publicKey);
    if (fromKey) return fromKey;
  }

  return null;
}

/**
 * Pull the first usable address out of a connect() result.
 *
 * `connect()` may resolve with the account directly, with `{ accounts: [...] }`,
 * with `{ publicKey }`, or with an empty collection when the wallet has not yet
 * populated its key (Phantom does this, then emits `change`).
 */
export function extractAddress(result: unknown): string | null {
  if (result == null) return null;

  const direct = normaliseAddress(result);
  if (direct) return direct;

  const record = result as { accounts?: unknown };

  if (Array.isArray(record.accounts)) {
    for (const account of record.accounts) {
      const address = normaliseAddress(account);
      if (address) return address;
    }
    return null;
  }

  if (Array.isArray(result)) {
    for (const account of result) {
      const address = normaliseAddress(account);
      if (address) return address;
    }
  }

  return null;
}

export function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Account sourcing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A wallet's connect function plus the fallback sources for its account.
 *
 * Phantom resolves `standard:connect` with `accounts: []` when its key is not
 * yet set, so a single call is not enough — every source is consulted, and a
 * change event is awaited as a last resort.
 */
interface AccountSources {
  connect: () => Promise<unknown>;
  /** Accounts already exposed by the wallet / feature. */
  accounts: () => unknown[];
  /** Legacy provider's current key. */
  publicKey: () => unknown;
  /** Change-event emitter, when the wallet exposes one. */
  events: {
    on: (handler: () => void) => void;
    off: (handler: () => void) => void;
  } | null;
}

async function settleAccount(sources: AccountSources, first: unknown): Promise<string | null> {
  const fromResult = extractAddress(first);
  if (fromResult) return fromResult;

  const accountList = sources.accounts();
  for (const account of accountList) {
    const address = normaliseAddress(account);
    if (address) return address;
  }

  const fromKey = normaliseAddress(sources.publicKey());
  if (fromKey) return fromKey;

  // Nothing yet. Phantom resolves standard:connect with an empty account list
  // when its key is not populated and delivers the account on the change event.
  if (!sources.events) return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sources.events?.off(check);
      } catch {
        /* emitter already torn down */
      }
      resolve(value);
    };

    const check = () => {
      const accounts = sources.accounts();
      for (const account of accounts) {
        const address = normaliseAddress(account);
        if (address) {
          finish(address);
          return;
        }
      }
      const fromKey = normaliseAddress(sources.publicKey());
      if (fromKey) finish(fromKey);
    };

    const timer = setTimeout(() => {
      recordDiag("account-settle-timeout", {
        accounts: safeShape(sources.accounts()),
        publicKey: safeShape(sources.publicKey()),
      });
      finish(null);
    }, ACCOUNT_SETTLE_TIMEOUT_MS);

    try {
      sources.events?.on(check);
    } catch {
      finish(null);
      return;
    }
    check();
  });
}

function pick<T>(
  features: Record<string, unknown> | undefined,
  keys: readonly string[],
  method: string,
): T | null {
  if (!features) return null;
  for (const key of keys) {
    const feature = features[key] as Record<string, unknown> | undefined;
    if (feature && typeof feature[method] === "function") {
      return feature[method] as T;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Chains a Wallet Standard wallet advertises, Solana-only.
 *
 * Exported because the anchoring gate must read the SAME shapes this module
 * already handles: `features.chains.supported` (the Wallet Standard spec) and
 * the legacy top-level `chains`. A second, narrower reader here is what
 * previously kept the Anchor button permanently disabled with a real Phantom,
 * because Phantom publishes chains under `features.chains.supported` only.
 */
export function chainsOf(wallet: WalletStandardWallet): string[] {
  const features = wallet.features as unknown as Record<string, unknown> | undefined;
  const chainsFeature = features?.chains as { supported?: unknown } | undefined;
  const topLevel = (wallet as unknown as { chains?: unknown }).chains;

  const list = Array.isArray(chainsFeature?.supported)
    ? (chainsFeature.supported as string[])
    : Array.isArray(topLevel)
      ? (topLevel as string[])
      : [];

  // Only Solana networks are relevant to this product.
  return list.filter((c) => c === "solana:mainnet" || c === "solana:devnet");
}

function fromStandard(wallet: WalletStandardWallet): DetectedWallet | null {
  const features = wallet.features as unknown as Record<string, unknown> | undefined;

  // Phantom names these `standard:connect` / `standard:disconnect`. The classic
  // `connect` / `connect:disconnect` names are kept for other wallets.
  const connect = pick<(...args: unknown[]) => Promise<unknown>>(
    features,
    CONNECT_FEATURE_KEYS,
    "connect",
  );
  if (!connect) return null;

  const disconnect = pick<() => Promise<void>>(features, DISCONNECT_FEATURE_KEYS, "disconnect");
  const eventsFeature = EVENTS_FEATURE_KEYS.map((k) => features?.[k]).find(
    (f): f is { on?: unknown } => !!f && typeof (f as { on?: unknown }).on === "function",
  ) as { on?: (e: string, h: () => void) => void; off?: (e: string, h: () => void) => void } | undefined;

  const rawAccounts = () => {
    const feature = features?.["connect:disconnect"] ?? features?.connect;
    const fromFeature = (feature as { accounts?: unknown } | undefined)?.accounts;
    if (Array.isArray(fromFeature) && fromFeature.length) return fromFeature;
    return wallet.accounts ?? [];
  };

  const sources: AccountSources = {
    connect: async () => {
      recordDiag(
        "standard:connect:invoke",
        {
          features: safeShape(Object.keys(features ?? {})),
          wallet: safeShape({ keys: Object.keys(wallet) }),
        },
        wallet.name,
        "standard",
      );
      const result = await connect();
      // Structure only — no addresses or values are recorded.
      recordDiag(
        "standard:connect:result",
        {
          result: safeShape(result),
          accounts: safeShape((result as { accounts?: unknown })?.accounts),
          featureAccounts: safeShape(rawAccounts()),
        },
        wallet.name,
        "standard",
      );
      return result;
    },
    accounts: rawAccounts,
    publicKey: () => null,
    events: eventsFeature?.on
      ? {
          on: (handler) => eventsFeature.on!("change", handler),
          off: (handler) => eventsFeature.off?.("change", handler),
        }
      : null,
  };

  return {
    id: `standard:${wallet.rdns ?? wallet.name}`,
    name: wallet.name,
    icon: wallet.icon,
    source: "standard",
    chains: chainsOf(wallet),
    existingAddresses: (wallet.accounts ?? [])
      .map((a) => normaliseAddress(a))
      .filter((a): a is string => Boolean(a)),
    connect: async () => {
      const result = await sources.connect();
      const address = await settleAccount(sources, result);
      if (!address) throw new Error("Wallet returned no account.");
      return address;
    },
    disconnect: async () => {
      await disconnect?.();
    },
  };
}

function legacySources(provider: LegacySolanaProvider): AccountSources {
  return {
    connect: async () => {
      recordDiag(
        "legacy:connect:invoke",
        { provider: safeShape({ keys: Object.keys(provider as object) }) },
        "legacy-provider",
        "legacy",
      );
      const result = await provider.connect();
      recordDiag(
        "legacy:connect:result",
        {
          result: safeShape(result),
          resultPublicKey: safeShape((result as { publicKey?: unknown })?.publicKey),
          providerPublicKey: safeShape(provider.publicKey),
        },
        "legacy-provider",
        "legacy",
      );
      return result;
    },
    accounts: () => [],
    publicKey: () => provider.publicKey,
    events: provider.on
      ? {
          on: (handler) => provider.on!("accountChanged", handler),
          off: (handler) => provider.off?.("accountChanged", handler),
        }
      : null,
  };
}

function legacyFromProvider(name: string, provider: LegacySolanaProvider): DetectedWallet | null {
  if (typeof provider?.connect !== "function") return null;
  const sources = legacySources(provider);
  return {
    id: `legacy:${name.toLowerCase()}`,
    name,
    source: "legacy",
    chains: [],
    existingAddresses: (() => {
      const address = normaliseAddress(provider.publicKey);
      return address ? [address] : [];
    })(),
    connect: async () => {
      const result = await sources.connect();
      // Phantom's legacy provider resolves `{ publicKey }` where publicKey is a
      // PublicKey instance — `normaliseAddress` unwraps it via toBase58().
      const address = await settleAccount(sources, result);
      if (!address) throw new Error("Wallet returned no account.");
      return address;
    },
    disconnect: async () => {
      await provider.disconnect?.();
    },
  };
}

/** `window.phantom.solana` — the canonical Phantom path. */
function legacyFromHost(name: string, host: LegacyHost | undefined): DetectedWallet | null {
  if (!host) return null;
  if (host.solana && typeof host.solana.connect === "function") {
    return legacyFromProvider(name, host.solana);
  }
  if (typeof host.connect === "function") {
    const sources: AccountSources = {
      connect: () => host.connect!(),
      accounts: () => [],
      publicKey: () => (host as { publicKey?: unknown }).publicKey,
      events: host.on
        ? {
            on: (handler) => host.on!("accountChanged", handler),
            off: (handler) => host.off?.("accountChanged", handler),
          }
        : null,
    };
    return {
      id: `legacy:${name.toLowerCase()}`,
      name,
      source: "legacy",
      chains: [],
      existingAddresses: (() => {
        const address = normaliseAddress((host as { publicKey?: unknown }).publicKey);
        return address ? [address] : [];
      })(),
      connect: async () => {
        const result = await sources.connect();
        const address = await settleAccount(sources, result);
        if (!address) throw new Error("Wallet returned no account.");
        return address;
      },
      disconnect: async () => {
        await host.disconnect?.();
      },
    };
  }
  return null;
}

/**
 * Read every legacy injected provider the page exposes right now.
 *
 * Wallet Standard is async and therefore handled by `discoverWallets()`; this
 * only covers the synchronous `window.*` injections.
 */
export function readLegacyProviders(): DetectedWallet[] {
  if (typeof window === "undefined") return [];

  const legacy: DetectedWallet[] = [];
  for (const [name, host] of [
    ["Phantom", window.phantom],
    ["Backpack", window.backpack],
    ["Xverse", window.xverse],
    ["Keplr", window.keplr],
  ] as const) {
    const found = legacyFromHost(name, host);
    if (found) legacy.push(found);
  }
  // `window.solana` is the bare provider Phantom and Backpack inject.
  if (!legacy.some((w) => w.name === "Phantom") && window.solana) {
    const bare = legacyFromProvider("Phantom", window.solana);
    if (bare) legacy.push(bare);
  }
  return legacy;
}

/**
 * Merge the two sources into the list the UI renders.
 *
 * Phantom exposes both APIs at once, so it must appear exactly once. The
 * Wallet Standard entry wins because it carries the icon and chain list.
 *
 * `announced` holds wallets pushed through `register()`. Some registries emit
 * the event before `get()` reflects the new wallet, so a wallet learned this
 * way is merged in even when `get()` still omits it.
 */
export async function discoverWallets(
  announced: WalletStandardWallet[] = [],
): Promise<DetectionResult> {
  const registry = navigator.wallets;

  let standard: DetectedWallet[] = [];
  let registryPresent = false;
  let registryThrew = false;

  if (registry) {
    registryPresent = true;
    try {
      const found = await registry.get();
      for (const wallet of found ?? []) {
        const normalised = fromStandard(wallet);
        if (normalised) standard.push(normalised);
      }
    } catch {
      registryThrew = true;
    }
  }

  const standardIds = new Set(standard.map((w) => w.id));
  for (const wallet of announced) {
    const normalised = fromStandard(wallet);
    if (normalised && !standardIds.has(normalised.id)) {
      standard.push(normalised);
      standardIds.add(normalised.id);
    }
  }

  const legacy = readLegacyProviders();

  const byId = new Map<string, DetectedWallet>();
  for (const w of legacy) byId.set(w.id, w);
  const seenNames = new Set<string>();
  for (const w of standard) {
    const existing = [...byId.values()].find((l) => l.name === w.name);
    if (existing) byId.delete(existing.id);
    byId.set(w.id, w);
    seenNames.add(w.name);
  }
  for (const w of legacy) {
    if (seenNames.has(w.name)) continue;
    byId.set(w.id, w);
  }

  return {
    wallets: [...byId.values()],
    registryPresent,
    registryThrew,
  };
}
