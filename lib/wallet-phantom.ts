/**
 * Phantom wallet shape, as read from the installed extension (v26.32.0).
 *
 * Recorded here because both facts broke the connect flow and neither is
 * discoverable from documentation — they were read out of the extension's own
 * injected bundle.
 *
 * 1. **Feature names.** Phantom implements Wallet Standard but names its
 *    features `standard:connect`, `standard:disconnect` and `standard:events`:
 *
 *        get features() {
 *          return {
 *            "standard:connect":    { version, connect },
 *            "standard:disconnect": { version, disconnect },
 *            "standard:events":     { version, on },
 *            "solana:signTransaction": { ... },
 *            ...
 *          }
 *        }
 *
 *    The string `connect:disconnect` does not appear anywhere in the extension.
 *    Code that only looks for `connect` / `connect:disconnect` therefore rejects
 *    Phantom's Wallet Standard wallet outright and falls back to the legacy shim.
 *
 * 2. **`publicKey` is a class instance, not a string.** The legacy provider
 *    exposes `publicKey` as a `PublicKey` object exposing `toBase58()`,
 *    `toBytes()`, `toBuffer()` and `toString()`. `connect()` resolves with
 *    `{ publicKey: <PublicKey instance> }`. Anything that assumes a base58
 *    string receives `null` and reports "no account".
 *
 * 3. **Account arrival can lag the connect call.** `standard:connect` calls the
 *    provider, then re-reads its public key and returns `this.accounts`, which
 *    is `[]` when the key is not yet set. The account is delivered later on the
 *    `standard:events` `change` event instead.
 */

/** Feature keys a wallet may use to expose a connect function. */
export const CONNECT_FEATURE_KEYS = [
  "standard:connect",
  "connect",
  "connect:disconnect",
] as const;

/** Feature keys a wallet may use to expose a disconnect function. */
export const DISCONNECT_FEATURE_KEYS = [
  "standard:disconnect",
  "connect:disconnect",
  "disconnect",
] as const;

/** Feature keys a wallet may use to expose a change-event emitter. */
export const EVENTS_FEATURE_KEYS = [
  "standard:events",
  "connect:disconnect",
  "connect",
] as const;

/**
 * How long to wait for an account to arrive via a change event before giving up.
 * Phantom resolves `standard:connect` with an empty `accounts` array when its
 * public key is not yet populated, and fills it in moments later.
 */
export const ACCOUNT_SETTLE_TIMEOUT_MS = 8000;
