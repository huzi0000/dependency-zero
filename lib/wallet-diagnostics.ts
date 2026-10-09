/**
 * Wallet diagnostics.
 *
 * Records the *shape* of what a wallet returned so provider-specific problems
 * can be diagnosed without exposing anything sensitive. Only these are ever
 * captured:
 *
 *   - provider name, and which API it was found through
 *   - feature key names
 *   - counts (how many accounts, how many features)
 *   - field names of returned objects
 *
 * Public addresses, key material, balances and any other values are never
 * recorded. `safeShape` deliberately has no path that can serialise a value.
 *
 * Enabled only when the page is loaded with `?dzdiag=1`. The summary is always
 * available on `window.__dzWalletDiag` so it can be read from DevTools without
 * enabling console output.
 */

export interface SafeShape {
  kind: string;
  /** Field names only. Never values. */
  fields?: string[];
  /** Method names only. Never values. */
  methods?: string[];
  count?: number;
  /** "yes" / "no" — whether a known key accessor exists. */
  hasToBase58?: "yes" | "no";
  hasToBytes?: "yes" | "no";
  hasPublicKey?: "yes" | "no";
  hasAddress?: "yes" | "no";
}

export interface WalletDiagEntry {
  at: string;
  step: string;
  provider?: string;
  source?: "standard" | "legacy";
  shapes: Record<string, SafeShape>;
}

const MAX_FIELDS = 24;

/**
 * Describes a value's shape without reading any of it.
 *
 * Deliberately structural: it inspects `typeof`, `Array.isArray`, key names and
 * method names, and returns booleans for known accessors.
 */
export function safeShape(value: unknown): SafeShape {
  if (value === null) return { kind: "null" };
  if (value === undefined) return { kind: "undefined" };

  const t = typeof value;
  if (t !== "object" && t !== "function") {
    // Primitives carry no structure worth reporting and no value is recorded.
    return { kind: t };
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      count: value.length,
      ...(value.length ? { sample: safeShape(value[0]) } as unknown as SafeShape : {}),
    };
  }

  const keys: string[] = [];
  const methods: string[] = [];
  let proto: object | null = Object.getPrototypeOf(value as object);

  try {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (keys.length < MAX_FIELDS) keys.push(key);
    }
  } catch {
    /* exotic object */
  }

  try {
    let level = 0;
    while (proto && proto !== Object.prototype && level < 4) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor") continue;
        if (typeof (proto as Record<string, unknown>)[key] === "function" && methods.length < MAX_FIELDS) {
          methods.push(key);
        }
      }
      proto = Object.getPrototypeOf(proto);
      level++;
    }
  } catch {
    /* ignore */
  }

  const shape: SafeShape = { kind: t };
  if (keys.length) shape.fields = keys;
  if (methods.length) shape.methods = methods;
  if (typeof (value as { toBase58?: unknown }).toBase58 === "function") shape.hasToBase58 = "yes";
  if (typeof (value as { toBytes?: unknown }).toBytes === "function") shape.hasToBytes = "yes";
  if ("publicKey" in (value as object)) shape.hasPublicKey = "yes";
  if ("address" in (value as object)) shape.hasAddress = "yes";
  return shape;
}

/** Diagnostic log, bounded so a long session cannot grow without limit. */
const entries: WalletDiagEntry[] = [];
const MAX_ENTRIES = 60;
let enabled = false;

export function initDiagnostics(): void {
  if (typeof window === "undefined") return;
  try {
    enabled = new URLSearchParams(window.location.search).get("dzdiag") === "1";
  } catch {
    enabled = false;
  }
  (window as unknown as { __dzWalletDiag?: WalletDiagEntry[] }).__dzWalletDiag = entries;
}

export function diagnosticsEnabled(): boolean {
  return enabled;
}

/**
 * Record one diagnostic step. `shapes` must be built with `safeShape`.
 * Nothing here can leak a value.
 */
export function recordDiag(
  step: string,
  shapes: Record<string, SafeShape>,
  provider?: string,
  source?: "standard" | "legacy",
): void {
  const entry: WalletDiagEntry = {
    at: new Date().toISOString(),
    step,
    shapes,
    ...(provider ? { provider } : {}),
    ...(source ? { source } : {}),
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  if (enabled) {
    // eslint-disable-next-line no-console
    console.info(`[dz-diag] ${step}${provider ? ` provider=${provider}` : ""}`, shapes);
  }
}

export function diagEntries(): WalletDiagEntry[] {
  return [...entries];
}

export function clearDiag(): void {
  entries.length = 0;
}
