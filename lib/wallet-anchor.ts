import { Connection, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/**
 * Client-side Phantom signing for attestation anchoring.
 *
 * SECURITY BOUNDARY — this is the whole point of this module:
 *
 *   The private key never leaves the wallet extension. The server builds an
 *   UNSIGNED transaction; this module hands it to the wallet; the wallet signs
 *   inside the user's extension and broadcasts. No seed phrase is ever
 *   requested, read, stored or transmitted, and this file contains no key
 *   material of any kind.
 *
 * WALLET STANDARD SIGNING — verified against the published spec
 * (`@wallet-standard/solana-features`, v0.1.0-alpha.3), not guessed:
 *
 *   'solana:signAndSendTransaction': {
 *     version: '1.0.0',
 *     supportedTransactionVersions: ('legacy' | 0)[],
 *     signAndSendTransaction: (...inputs) => Promise<Output[]>,
 *   }
 *
 * An earlier version of this module got every one of these wrong, which is why
 * a real Phantom never showed an approval prompt:
 *
 *   WRONG: feature.getSignAndSendTransaction?.()        -> no such getter
 *   WRONG: signAndSend(tx, { cluster: 'devnet' })       -> positional + `cluster` is not an option
 *   WRONG: treated the result as { signature }           -> it is an ARRAY of outputs
 *   WRONG: passed a legacy Transaction unconditionally   -> version must match the wallet's list
 *   WRONG: omitted the account                           -> the wallet needs to know which key
 *
 * A stub written to match the wrong shape passes against a wrong shape. The
 * interface is the contract; this module now implements the contract.
 */

export const DEVNET_CLUSTER = "devnet";
export const DEVNET_RPC = "https://api.devnet.solana.com";

export type AnchorPhase =
  | "idle"
  | "preparing"
  | "awaiting_wallet"
  | "submitting"
  | "confirming"
  | "confirmed"
  | "rejected"
  | "failed"
  | "wrong_network"
  | "insufficient_funds";

export interface AnchorState {
  phase: AnchorPhase;
  error: string | null;
  signature: string | null;
}

export const IDLE: AnchorState = { phase: "idle", error: null, signature: null };

/* -------------------------------------------------------------------------- */
/* Wallet Standard shapes (declared locally; no wallet-adapter dependency)    */
/* -------------------------------------------------------------------------- */

interface WalletAccount {
  address: string;
  purpose?: string[];
}

interface StdSignAndSendOutput {
  signature: string;
}

interface StdSignTransactionOutput {
  signature: string;
  signedTransaction?: VersionedTransaction;
}

interface StdWallet {
  name?: string;
  accounts?: readonly WalletAccount[];
  features?: Record<string, unknown>;
}

interface StdSignAndSendFeature {
  version?: string;
  supportedTransactionVersions?: readonly (0 | "legacy")[];
  signAndSendTransaction: (
    ...inputs: {
      transaction: VersionedTransaction | Transaction;
      account: WalletAccount;
      options?: {
        commitment?: "processed" | "confirmed" | "finalized";
        skipPreflight?: boolean;
        maxRetries?: number;
        preflightCommitment?: "processed" | "confirmed" | "finalized";
        minContextSlot?: number;
      };
    }[]
  ) => Promise<StdSignAndSendOutput[]>;
}

interface StdSignFeature {
  version?: string;
  supportedTransactionVersions?: readonly (0 | "legacy")[];
  signTransaction: (
    ...inputs: {
      transaction: VersionedTransaction | Transaction;
      account: WalletAccount;
      options?: { minContextSlot?: number; preflightCommitment?: string };
    }[]
  ) => Promise<StdSignTransactionOutput[]>;
}

export interface ResolvedSigner {
  name: string;
  address: string;
  /** True when the wallet itself broadcasts the transaction. */
  canSend: boolean;
  signAndSend(tx: VersionedTransaction | Transaction, account: WalletAccount): Promise<string>;
  signOnly(tx: VersionedTransaction | Transaction, account: WalletAccount): Promise<VersionedTransaction>;
  /** Whether the wallet prefers v0 messages; drives which type we build. */
  prefersVersioned: boolean;
}

/* -------------------------------------------------------------------------- */
/* Provider resolution                                                         */
/* -------------------------------------------------------------------------- */

function standardWallets(): readonly StdWallet[] {
  const registry = (globalThis as { navigator?: { wallets?: unknown } }).navigator?.wallets;
  return Array.isArray(registry) ? (registry as StdWallet[]) : [];
}

/** Find the Wallet Standard wallet that owns `address`, plus that account. */
export function findStandardAccount(
  address: string,
): { wallet: StdWallet; account: WalletAccount } | null {
  for (const wallet of standardWallets()) {
    const accounts = wallet.accounts ?? [];
    const exact = accounts.find((a) => a?.address === address);
    if (exact) return { wallet, account: exact };
  }
  return null;
}

/** Legacy injected provider, whose API is genuinely different and positional. */
function legacyProvider(address: string | null): ResolvedSigner | null {
  const w = (
    globalThis as unknown as {
      phantom?: { solana?: Record<string, unknown> };
      solana?: Record<string, unknown>;
    }
  ).phantom?.solana ?? (globalThis as { solana?: Record<string, unknown> }).solana;
  if (!w) return null;

  const send = w.signAndSendTransaction as
    | ((tx: Transaction) => Promise<{ signature?: string } | string>)
    | undefined;
  const sign = w.signTransaction as ((tx: Transaction) => Promise<Transaction>) | undefined;
  if (!send && !sign) return null;
  const sendFn = send;
  const signFn = sign;

  let detected: string | null = address;
  if (!detected) {
    try {
      detected = (w.publicKey as { toBase58?: () => string } | undefined)?.toBase58?.() ?? null;
    } catch {
      detected = null;
    }
  }
  if (!detected) return null;

  return {
    name: "Phantom (legacy API)",
    address: detected,
    canSend: Boolean(send),
    prefersVersioned: false,
    async signAndSend(tx) {
      const r = await sendFn!(tx as Transaction);
      const sig = typeof r === "string" ? r : r?.signature;
      if (!sig) throw new Error("Wallet broadcast without returning a signature.");
      return sig;
    },
    async signOnly(tx) {
      if (!signFn) throw new Error("Wallet exposes no signTransaction method.");
      const signed = await signFn!(tx as Transaction);
      // The legacy API returns a legacy Transaction; normalise to a versioned one.
      const message = new TransactionMessage({
        payerKey: signed.feePayer ?? new PublicKey(detected),
        recentBlockhash: signed.recentBlockhash ?? "",
        instructions: signed.instructions,
      }).compileToV0Message();
      return new VersionedTransaction(message);
    },
  };
}

/**
 * Resolve a signing provider bound to the connected address.
 *
 * A stored address is NOT treated as proof of authorisation: the wallet entry
 * must be present in the live registry and must actually own that address.
 */
export function resolveSigner(address: string | null, walletName: string | null): ResolvedSigner | null {
  if (address) {
    const found = findStandardAccount(address);
    if (found) {
      const features = (found.wallet.features ?? {}) as Record<string, unknown>;
      const sendFeature = features["solana:signAndSendTransaction"] as StdSignAndSendFeature | undefined;
      const signFeature = features["solana:signTransaction"] as StdSignFeature | undefined;
      const versions = sendFeature?.supportedTransactionVersions ?? signFeature?.supportedTransactionVersions;

      if (typeof sendFeature?.signAndSendTransaction === "function") {
        return {
          name: found.wallet.name ?? walletName ?? "Wallet",
          address,
          canSend: true,
          // A wallet advertising v0 (0) can take a versioned transaction; one
          // advertising only 'legacy' must be given the legacy type.
          prefersVersioned: Array.isArray(versions) ? versions.includes(0) : true,
          async signAndSend(tx, account) {
            // Variadic method returning an array of outputs.
            const outputs = await sendFeature.signAndSendTransaction({
              transaction: tx,
              account,
              options: { commitment: "confirmed" },
            });
            const sig = outputs?.[0]?.signature;
            if (!sig) throw new Error("Wallet returned no transaction signature.");
            return sig;
          },
          async signOnly(tx, account) {
            if (!signFeature?.signTransaction) throw new Error("Wallet exposes no signTransaction feature.");
            const outputs = await signFeature.signTransaction({ transaction: tx, account });
            const out = outputs?.[0];
            if (!out?.signedTransaction) throw new Error("Wallet returned no signed transaction.");
            return out.signedTransaction;
          },
        };
      }

      if (typeof signFeature?.signTransaction === "function") {
        return {
          name: found.wallet.name ?? walletName ?? "Wallet",
          address,
          canSend: false,
          prefersVersioned: Array.isArray(versions) ? versions.includes(0) : true,
          async signAndSend() {
            throw new Error("Wallet can sign but cannot broadcast.");
          },
          async signOnly(tx, account) {
            const outputs = await signFeature.signTransaction({ transaction: tx, account });
            const out = outputs?.[0];
            if (!out?.signedTransaction) throw new Error("Wallet returned no signed transaction.");
            return out.signedTransaction;
          },
        };
      }
    }
  }

  return legacyProvider(address);
}

/* -------------------------------------------------------------------------- */
/* Error classification                                                        */
/* -------------------------------------------------------------------------- */

function classify(err: unknown): { phase: AnchorPhase; error: string } {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : ((err as { message?: string } | null)?.message ?? "");
  const code = Number((err as { code?: unknown } | null)?.code ?? NaN);
  const text = `${raw} ${(err as { name?: string } | null)?.name ?? ""}`.toLowerCase();

  if (code === 4001 || /reject|declin|denied|cancell?ed/.test(text)) {
    return { phase: "rejected", error: "You declined the transaction in your wallet. Nothing was submitted." };
  }
  if (/insufficient|0x lamports/.test(text)) {
    return {
      phase: "insufficient_funds",
      error: "Your wallet does not have enough Devnet SOL for the fee. Get test SOL on Devnet, then retry.",
    };
  }
  if (/blockhash|expired|too old/.test(text)) {
    return { phase: "failed", error: "The transaction expired before approval. Click Anchor on Solana again for a fresh one." };
  }
  if (/wrong network|unsupported cluster|mainnet/.test(text)) {
    return { phase: "wrong_network", error: "Your wallet is on a different cluster. Switch Phantom to Solana Devnet and retry." };
  }
  if (/not connected|not authori[sz]ed|unauthori[sz]ed|authorization/.test(text)) {
    return { phase: "failed", error: "Your wallet is not authorised for this site. Unlock Phantom and reconnect." };
  }
  if (/not implemented|no sign|does not support|unsupported/.test(text)) {
    return { phase: "failed", error: `The detected wallet cannot sign Solana transactions: ${raw || "no signing feature advertised"}.` };
  }
  return { phase: "failed", error: raw ? `Wallet request failed: ${raw}` : "The wallet request failed for an unknown reason." };
}

/* -------------------------------------------------------------------------- */
/* Flow                                                                        */
/* -------------------------------------------------------------------------- */

interface Prepared {
  ok: boolean;
  transaction?: string | null;
  commitment?: string | null;
  error?: string | null;
}

function currentSession(): { address: string | null; walletName: string | null } {
  try {
    const raw = window.localStorage.getItem("dz:wallet");
    if (!raw) return { address: null, walletName: null };
    const p = JSON.parse(raw) as { address?: unknown; walletName?: unknown };
    return {
      address: typeof p.address === "string" ? p.address : null,
      walletName: typeof p.walletName === "string" ? p.walletName : null,
    };
  } catch {
    return { address: null, walletName: null };
  }
}

export async function anchorWithWallet(scanId: string): Promise<AnchorState> {
  const session = currentSession();
  if (!session.address) {
    return { phase: "failed", error: "No wallet session found. Connect Phantom in the header first.", signature: null };
  }

  const signer = resolveSigner(session.address, session.walletName);
  if (!signer) {
    return {
      phase: "failed",
      error:
        "No wallet advertising a Solana signing feature was found for the connected address. " +
        "Unlock Phantom, enable it for this site, and reconnect.",
      signature: null,
    };
  }

  // 1. Prepare on the server.
  let prepared: Prepared;
  try {
    const res = await fetch(`/api/attestations/${encodeURIComponent(scanId)}/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    prepared = (await res.json()) as Prepared;
  } catch (e) {
    return { phase: "failed", error: `Could not reach the server to prepare the transaction: ${(e as Error).message}`, signature: null };
  }
  if (!prepared.ok || !prepared.transaction) {
    return { phase: "failed", error: prepared.error ?? "The server could not prepare a transaction for this scan.", signature: null };
  }

  const connection = new Connection(DEVNET_RPC, "confirmed");

  // 2. Rebuild with the wallet as fee payer and a fresh blockhash.
  let legacyTx: Transaction;
  let instructions: Transaction["instructions"];
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    legacyTx = Transaction.from(Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)));
    legacyTx.feePayer = new PublicKey(session.address);

    /**
     * Drop the server placeholder's signature slots.
     *
     * The server serialises an unsigned transaction using `PublicKey.default`
     * (the System Program, `11111111111111111111111111111111`) as a stand-in fee
     * payer, because `serialize()` requires one. That placeholder is written into
     * the signature array of the wire format and `Transaction.from` restores it
     * here.
     *
     * Now that the real wallet is the fee payer that entry is stale. Left in place
     * it fails the moment the wallet serialises the transaction to sign it, because
     * `compileMessage()` rejects any signature whose public key is not an account in
     * the transaction:
     *
     *   unknown signer: 11111111111111111111111111111111
     *
     * thrown inside the wallet before it ever shows an approval prompt. Clearing
     * the array lets `_compile()` rebuild the slot from the real account keys, which
     * is exactly what the wallet fills in when it signs.
     */
    legacyTx.signatures = [];
    const latest = await connection.getLatestBlockhash("confirmed");
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight + 150;
    legacyTx.recentBlockhash = blockhash;
    legacyTx.lastValidBlockHeight = lastValidBlockHeight;
    instructions = legacyTx.instructions;
  } catch (e) {
    return { phase: "failed", error: `Could not assemble the transaction: ${(e as Error).message}`, signature: null };
  }

  // 3. Match the transaction type to what the wallet advertises.
  const account = { address: session.address, purpose: ["signTransaction"] };
  let payload: VersionedTransaction | Transaction;
  try {
    if (signer.prefersVersioned) {
      const message = new TransactionMessage({
        payerKey: new PublicKey(session.address),
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      payload = new VersionedTransaction(message);
    } else {
      payload = legacyTx;
    }
  } catch (e) {
    return { phase: "failed", error: `Could not build the transaction message: ${(e as Error).message}`, signature: null };
  }

  // 4. Hand it to the wallet. This is the step that opens the approval prompt.
  let signature: string;
  try {
    if (signer.canSend) {
      signature = await signer.signAndSend(payload, account);
    } else {
      const signed = await signer.signOnly(payload, account);
      signature = await connection.sendRawTransaction(signed.serialize(), {
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
    }
  } catch (e) {
    return { ...classify(e), signature: null };
  }

  // 5. Server verifies independently before anything is marked anchored.
  try {
    const res = await fetch(`/api/attestations/${encodeURIComponent(scanId)}/record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    const recorded = (await res.json()) as { status?: string; error?: string | null; commitmentMatches?: boolean };

    if (recorded.status === "confirmed" && recorded.commitmentMatches === true) {
      return { phase: "confirmed", error: null, signature };
    }
    if (recorded.status === "pending") {
      return {
        phase: "confirming",
        error: "Sent but not confirmed yet. It will reconcile automatically; do not submit again or you may anchor twice.",
        signature,
      };
    }
    return {
      phase: "failed",
      error: recorded.error ?? "The transaction was sent but did not verify as this scan's commitment.",
      signature,
    };
  } catch (e) {
    return {
      phase: "confirming",
      error: `Transaction sent (${signature}) but verification is unreachable: ${(e as Error).message}. It will reconcile on refresh.`,
      signature,
    };
  }
}

/** Confirming is a pure read: re-verify a signature we already have. */
export async function reconcile(scanId: string, signature: string): Promise<AnchorState> {
  try {
    const res = await fetch(`/api/attestations/${encodeURIComponent(scanId)}/record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    const r = (await res.json()) as { status?: string; error?: string | null; commitmentMatches?: boolean };
    if (r.status === "confirmed" && r.commitmentMatches === true) {
      return { phase: "confirmed", error: null, signature };
    }
    if (r.status === "pending") return { phase: "confirming", error: r.error ?? null, signature };
    return { phase: "failed", error: r.error ?? "Verification failed.", signature };
  } catch (e) {
    return { phase: "confirming", error: `Devnet is unreachable right now: ${(e as Error).message}`, signature };
  }
}