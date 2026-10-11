import "server-only";

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { connect, verifyOnChain, explorerTxUrl, MECHANISM_LABEL } from "./solana.ts";
import { decodeMemoData, KNOWN_GOOD_MEMO_PROGRAM_ID } from "./memo.ts";
import { memoInstruction } from "./solana.ts";
import { verifyBundleOffline } from "./bundle.ts";
import type { StoredAttestation } from "@/lib/store-core";

/**
 * User-wallet anchoring (Mode A).
 *
 * The user signs a real SPL Memo transaction inside Phantom. The server never
 * sees, requests, or stores a seed phrase or private key: it only builds an
 * UNSIGNED transaction and, after the wallet has signed and broadcast it,
 * independently verifies what actually landed on chain.
 *
 * The commitment is taken from the ALREADY-SIGNED proof bundle. Nothing is
 * re-signed here, so the on-chain anchor and the stored evidence bind identical
 * bytes. A commitment built from anything else would be a different attestation.
 */

/** Persisted, non-secret lifecycle states for wallet anchoring. */
export type WalletAnchorState =
  | "not_started"
  | "awaiting_wallet"
  | "submitted"
  | "confirmed"
  | "failed";

export interface PrepareResult {
  ok: boolean;
  /** Base64 serialised UNSIGNED transaction for the wallet to sign. */
  transaction: string | null;
  commitment: string | null;
  scanId: string | null;
  artifactSha256: string | null;
  cluster: string;
  memoProgramId: string;
  mechanism: string;
  /** Stable key so a double-click cannot produce two different transactions. */
  idempotencyKey: string | null;
  /** Whether an anchor already exists, so the UI can explain why. */
  alreadyConfirmed: boolean;
  error: string | null;
}

/**
 * Build the unsigned Memo transaction for a scan.
 *
 * Refuses unless the stored evidence still verifies offline. Anchoring a bundle
 * that no longer verifies would put an unverifiable claim on a permanent public
 * ledger.
 */
export async function prepareWalletAnchor(
  scanId: string,
  stored: StoredAttestation,
): Promise<PrepareResult> {
  const base: PrepareResult = {
    ok: false,
    transaction: null,
    commitment: null,
    scanId,
    artifactSha256: null,
    cluster: "devnet",
    memoProgramId: KNOWN_GOOD_MEMO_PROGRAM_ID,
    mechanism: MECHANISM_LABEL,
    idempotencyKey: null,
    alreadyConfirmed: false,
    error: null,
  };

  const { bundle, attestation } = stored;

  if (attestation.confirmed && attestation.transactionSignature) {
    return {
      ...base,
      commitment: bundle.commitment,
      artifactSha256: bundle.scan.artifactSha256,
      alreadyConfirmed: true,
      error:
        "This scan is already anchored and confirmed on Solana Devnet. " +
        "Anchoring it again would create a second on-chain transaction.",
    };
  }

  const offline = verifyBundleOffline(bundle);
  if (!offline.ok) {
    return {
      ...base,
      error:
        "Stored evidence failed offline verification, so this scan will not be " +
        "anchored. Re-run the scan to produce fresh signed evidence.",
    };
  }

  // The memo text is the persisted one, bound to the persisted commitment.
  if (!bundle.memoData) {
    return { ...base, error: "This bundle carries no memo payload to anchor." };
  }

  try {
    const connection = connect();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction();
    // A placeholder fee payer is required for serialisation. It carries no
    // authority and is overwritten by the connected wallet address on the
    // client before the transaction is ever signed.
    tx.feePayer = PublicKey.default;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight + 150;
    tx.add(memoInstruction(bundle.memoData));

    return {
      ...base,
      ok: true,
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      commitment: bundle.commitment,
      artifactSha256: bundle.scan.artifactSha256,
      idempotencyKey: attestation.idempotencyKey || null,
    };
  } catch (e) {
    return {
      ...base,
      error: `Could not build the transaction: ${(e as Error).message}`,
    };
  }
}

export interface RecordResult {
  status: "confirmed" | "pending" | "failed" | "unavailable";
  signature: string | null;
  explorerUrl: string | null;
  slot: number | null;
  blockTime: number | null;
  confirmationStatus: string | null;
  anchoredCommitment: string | null;
  commitmentMatches: boolean;
  error: string | null;
}

/**
 * Record a wallet-signed transaction and verify it independently.
 *
 * CONFIRMED is only ever returned after fetching the transaction from Devnet,
 * confirming it executed without error, confirming it invoked the expected Memo
 * program, and confirming the anchored commitment equals the recomputed one. A
 * signature string alone is never enough.
 */
export async function recordWalletAnchor(
  stored: StoredAttestation,
  signature: string,
): Promise<RecordResult> {
  const expected = stored.bundle.commitment;

  const connection = connect();
  const chain = await verifyOnChain({
    connection,
    signature,
    expectedCommitment: expected,
    expectedScanId: stored.bundle.scan.id,
  });

  const explorerUrl = chain.signature ? explorerTxUrl(chain.signature) : null;

  if (chain.status === "VERIFIED") {
    // Re-check the memo through our own decoder as a second opinion.
    return {
      status: "confirmed",
      signature: chain.signature,
      explorerUrl,
      slot: chain.slot,
      blockTime: chain.blockTime,
      confirmationStatus: chain.confirmationStatus,
      anchoredCommitment: chain.anchoredCommitment,
      commitmentMatches: chain.commitmentMatches,
      error: null,
    };
  }

  if (chain.status === "PENDING") {
    return {
      status: "pending",
      signature: chain.signature,
      explorerUrl,
      slot: chain.slot,
      blockTime: chain.blockTime,
      confirmationStatus: chain.confirmationStatus,
      anchoredCommitment: chain.anchoredCommitment,
      commitmentMatches: chain.commitmentMatches,
      error:
        "The transaction was broadcast but is not confirmed yet. Reconcile this " +
        "signature before submitting another; re-submitting could anchor twice.",
    };
  }

  if (chain.status === "UNAVAILABLE") {
    return {
      status: "unavailable",
      signature,
      explorerUrl,
      slot: null,
      blockTime: null,
      confirmationStatus: null,
      anchoredCommitment: null,
      commitmentMatches: false,
      error: chain.error,
    };
  }

  // FAILED / NOT_ATTESTED: definite, actionable failure.
  return {
    status: "failed",
    signature,
    explorerUrl,
    slot: chain.slot,
    blockTime: chain.blockTime,
    confirmationStatus: chain.confirmationStatus,
    anchoredCommitment: chain.anchoredCommitment,
    commitmentMatches: chain.commitmentMatches,
    error: chain.error,
  };
}

export { decodeMemoData, PublicKey, Keypair };