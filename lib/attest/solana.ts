import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

/**
 * Solana Devnet attestation layer.
 *
 * MECHANISM, stated exactly and without embellishment:
 *
 * No on-chain program is deployed. This environment has no Rust, cargo, solana
 * CLI or Anchor, so compiling and deploying a registry program is impossible
 * here. Rather than pretend otherwise, the commitment is anchored with the
 * well-known SPL Memo program (MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr).
 *
 * Every attestation produced this way is labelled:
 *   "Solana Devnet commitment anchored via Memo"
 *
 * A Memo transaction IS a real, immutable, publicly verifiable Devnet
 * transaction. It is NOT a deployed registry program, NOT a smart-contract
 * attestation system, and there is no on-chain registry account. Nothing in this
 * module claims otherwise.
 *
 * What Solana genuinely provides here is tamper-evident timestamping: the
 * commitment hash is bound to a specific slot in a public ledger that nobody,
 * including this operator, can rewrite afterwards.
 */

import {
  CLUSTER,
  DEVNET_RPC,
  KNOWN_GOOD_MEMO_PROGRAM_ID,
  assertKnownGoodMemoProgram,
  decodeMemoData,
  encodeMemoData,
  explorerTxUrl,
  isKnownGoodMemoProgram,
  MECHANISM_LABEL,
  MEMO_PROGRAM_ID,
} from "./memo.ts";

// Re-exported so existing importers keep a single site, and so the encoding has
// exactly one implementation shared with the standalone verifier.
export { MEMO_PROGRAM_ID, MECHANISM_LABEL, CLUSTER, DEVNET_RPC, explorerTxUrl } from "./memo.ts";
export { decodeMemoData, encodeMemoData };

export type AttestationStatus =
  | "not_started"
  | "signing"
  | "ready_to_submit"
  | "submitted"
  | "confirmed"
  | "failed";

export interface AttestationRecord {
  schemaVersion: string;
  mechanism: string;
  mechanismLabel: string;
  cluster: string;
  commitmentHash: string;
  scanId: string;
  artifactSha256: string;
  status: AttestationStatus;
  /** Null until a transaction was actually submitted. Never fabricated. */
  transactionSignature: string | null;
  slot: number | null;
  confirmationStatus: string | null;
  blockTime: number | null;
  explorerUrl: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  /** True only once the signature was actually observed on chain. */
  confirmed: boolean;
  error: string | null;
  /** Memo text, retained so the anchor can be independently recomputed. */
  memoData: string | null;
  memoProgramId: string;
  /** Idempotency key so a retry cannot double-anchor the same scan. */
  idempotencyKey: string;
}

/** Bounded connection with explicit timeouts. */
export function connect(rpcUrl = DEVNET_RPC): Connection {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Signer                                                                      */
/* -------------------------------------------------------------------------- */

export interface SignerResolution {
  keypair: Keypair | null;
  source: "env_keypair" | "keypair_file" | "unavailable";
  detail: string;
}

/**
 * Resolve an authorised server-side Devnet signer.
 *
 * Preference order, both outside the repository:
 *   1. DZ_SOLANA_KEYPAIR_BASE58  - 64 comma-separated secret-key bytes
 *   2. DZ_SOLANA_KEYPAIR_FILE    - path to a JSON keypair array
 *
 * The user's Phantom wallet is NEVER used here. Extracting a browser wallet's
 * private key would be unacceptable; automated anchoring requires an explicitly
 * provisioned service key.
 */
export function resolveSigner(): SignerResolution {
  const fromEnv = process.env.DZ_SOLANA_KEYPAIR_BASE58?.trim();
  if (fromEnv) {
    try {
      const bytes = Uint8Array.from(fromEnv.split(",").map((s) => Number(s.trim())));
      if (bytes.length === 64) {
        return {
          keypair: Keypair.fromSecretKey(bytes),
          source: "env_keypair",
          detail: "DZ_SOLANA_KEYPAIR_BASE58",
        };
      }
      return {
        keypair: null,
        source: "unavailable",
        detail: `DZ_SOLANA_KEYPAIR_BASE58 has ${bytes.length} bytes, expected 64.`,
      };
    } catch (e) {
      return {
        keypair: null,
        source: "unavailable",
        detail: `DZ_SOLANA_KEYPAIR_BASE58 is not a valid secret key: ${(e as Error).message}`,
      };
    }
  }

  const file = process.env.DZ_SOLANA_KEYPAIR_FILE?.trim();
  if (file) {
    try {
      const arr = JSON.parse(readFileSync(file, "utf8")) as number[];
      if (!Array.isArray(arr) || arr.length !== 64) {
        return {
          keypair: null,
          source: "unavailable",
          detail: `Keypair file ${file} is not a 64-element JSON array.`,
        };
      }
      return { keypair: Keypair.fromSecretKey(Uint8Array.from(arr)), source: "keypair_file", detail: file };
    } catch (e) {
      return {
        keypair: null,
        source: "unavailable",
        detail: `Keypair file unreadable: ${(e as Error).message}`,
      };
    }
  }

  return {
    keypair: null,
    source: "unavailable",
    detail:
      "No authorised Devnet signer provisioned. Set DZ_SOLANA_KEYPAIR_BASE58 or DZ_SOLANA_KEYPAIR_FILE.",
  };
}

/* -------------------------------------------------------------------------- */
/* Memo transaction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build the SPL Memo instruction.
 *
 * ENCODING, established empirically against Devnet by simulation (not assumed):
 *
 * The SPL Memo program at MEMO_PROGRAM_ID takes the instruction data as RAW
 * UTF-8. It does NOT use the bincode `Memo { data: String }` length-prefixed
 * form that Memo v1 uses.
 *
 * Sending the v1 form is rejected. The program attempts to decode byte 0 of the
 * data as UTF-8; a length prefix starts with 0xE2 for a 226-byte memo, which is
 * not valid UTF-8, and the transaction fails with:
 *
 *   InstructionError [0, "InvalidInstructionData"]
 *   log: Program log: Invalid UTF-8, from byte 0
 *
 * Confirmed accepted form, from Devnet program logs:
 *   Program log: Memo (len 226): "D0/d0-attestation/1 | c=57a6579d... | ..."
 */
export function memoInstruction(memoText: string, programId: string = MEMO_PROGRAM_ID): TransactionInstruction {
  // Fail closed on the WRITE path. If the configured program ever stops being
  // the Memo program we recognise, no instruction is built at all.
  assertKnownGoodMemoProgram(programId);
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [],
    data: encodeMemoData(memoText),
  });
}


/** Build an unsigned Memo transaction carrying the commitment. */
export async function buildMemoTransaction(params: {
  connection: Connection;
  payer: PublicKey;
  memoText: string;
  recentBlockhash: string;
}): Promise<Transaction> {
  const tx = new Transaction();
  tx.add(memoInstruction(params.memoText));
  tx.recentBlockhash = params.recentBlockhash;
  tx.feePayer = params.payer;
  const latest = await params.connection.getLatestBlockhash("confirmed");
  tx.lastValidBlockHeight = latest.lastValidBlockHeight + 150;
  return tx;
}

/** Deterministic idempotency key, so a retry cannot double-anchor a scan. */
export function idempotencyKeyFor(scanId: string, commitment: string): string {
  return createHash("sha256").update(`${scanId}:${commitment}`).digest("hex").slice(0, 32);
}

/**
 * Submit the commitment and wait for a documented confirmation level.
 *
 * `confirmed` is set ONLY after the RPC reports the signature present AND the
 * transaction reports success. An unknown or failed outcome is never recorded
 * as confirmed.
 */
export async function anchorCommitment(params: {
  connection: Connection;
  signer: Keypair;
  memoText: string;
  commitmentHash: string;
  scanId: string;
  artifactSha256: string;
  idempotencyKey: string;
}): Promise<AttestationRecord> {
  const base = {
    schemaVersion: "d0-attestation/1",
    mechanism: "spl-memo",
    mechanismLabel: MECHANISM_LABEL,
    cluster: CLUSTER,
    commitmentHash: params.commitmentHash,
    scanId: params.scanId,
    artifactSha256: params.artifactSha256,
    confirmationStatus: null as string | null,
    blockTime: null as number | null,
    explorerUrl: null as string | null,
    submittedAt: new Date().toISOString() as string | null,
    confirmedAt: null as string | null,
    memoData: params.memoText as string | null,
    memoProgramId: MEMO_PROGRAM_ID,
    idempotencyKey: params.idempotencyKey,
  };

  try {
    const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
    const tx = await buildMemoTransaction({
      connection: params.connection,
      payer: params.signer.publicKey,
      memoText: params.memoText,
      recentBlockhash: blockhash,
    });

    // Sign before serialising. sendRawTransaction submits bytes verbatim, so an
    // unsigned transaction would be rejected by the cluster with
    // "Missing signature for public key".
    tx.sign(params.signer);
    if (!tx.signature) {
      throw new Error("Transaction produced no signature after signing.");
    }
    const signature = await params.connection.sendRawTransaction(tx.serialize());

    const res = await params.connection.confirmTransaction(signature, "confirmed");

    if (res.value?.err) {
      return {
        ...base,
        status: "failed",
        transactionSignature: signature,
        slot: res.context.slot,
        confirmationStatus: "confirmed",
        explorerUrl: explorerTxUrl(signature),
        confirmed: false,
        error: `Transaction failed on chain: ${JSON.stringify(res.value.err)}`,
      };
    }

    const detail = await params.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    return {
      ...base,
      status: "confirmed",
      transactionSignature: signature,
      slot: detail?.slot ?? res.context.slot,
      confirmationStatus: "confirmed",
      blockTime: detail?.blockTime ?? null,
      explorerUrl: explorerTxUrl(signature),
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      error: null,
    };
  } catch (e) {
    return {
      ...base,
      status: "failed",
      transactionSignature: null,
      slot: null,
      confirmed: false,
      error: `Submission failed: ${(e as Error).message}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Independent chain verification                                              */
/* -------------------------------------------------------------------------- */

export interface ChainVerification {
  status: "VERIFIED" | "PENDING" | "FAILED" | "UNAVAILABLE" | "NOT_ATTESTED";
  cluster: string;
  signature: string | null;
  /** Commitment parsed back out of the on-chain Memo instruction. */
  anchoredCommitment: string | null;
  memoProgramId: string | null;
  slot: number | null;
  blockTime: number | null;
  confirmationStatus: string | null;
  explorerUrl: string | null;
  /** True only when the transaction exists, succeeded, invoked the expected
   *  Memo program, and carried exactly the expected commitment and scan id. */
  commitmentMatches: boolean;
  error: string | null;
}

/**
 * Verify a commitment against the real chain.
 *
 * Deliberately trusts no local flag: it fetches the transaction, checks it
 * succeeded, checks it really invoked the Memo program, and compares the
 * commitment parsed out of the on-chain instruction data. A signature string
 * alone is never sufficient for VERIFIED.
 */
export async function verifyOnChain(params: {
  connection: Connection;
  signature: string | null;
  expectedCommitment: string;
  expectedScanId: string;
}): Promise<ChainVerification> {
  const base: ChainVerification = {
    status: "NOT_ATTESTED",
    cluster: CLUSTER,
    signature: params.signature,
    anchoredCommitment: null,
    memoProgramId: null,
    slot: null,
    blockTime: null,
    explorerUrl: params.signature ? explorerTxUrl(params.signature) : null,
    confirmationStatus: null,
    commitmentMatches: false,
    error: null,
  };

  if (!params.signature) {
    return { ...base, status: "NOT_ATTESTED", error: "No transaction signature recorded." };
  }

  let tx: Awaited<ReturnType<Connection["getTransaction"]>>;
  try {
    tx = await params.connection.getTransaction(params.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (e) {
    // RPC trouble must read as UNAVAILABLE, never as VERIFIED or FAILED.
    return { ...base, status: "UNAVAILABLE", error: `RPC error: ${(e as Error).message}` };
  }

  if (!tx) {
    try {
      const statuses = await params.connection.getSignatureStatuses([params.signature]);
      const st = statuses.value[0];
      if (st) {
        return {
          ...base,
          status: "PENDING",
          slot: st.slot,
          confirmationStatus: st.confirmationStatus ?? null,
          error: `Transaction seen but not confirmed (${st.confirmationStatus}).`,
        };
      }
    } catch {
      /* fall through to the generic pending result */
    }
    return {
      ...base,
      status: "PENDING",
      error: "Transaction not yet visible at the confirmed commitment.",
    };
  }

  if (tx.meta?.err) {
    return {
      ...base,
      status: "FAILED",
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      error: `Transaction failed on chain: ${JSON.stringify(tx.meta.err)}`,
    };
  }

  // Find the Memo invocation among the compiled instructions.
  //
  // Validated against KNOWN_GOOD_MEMO_PROGRAM_ID, not against MEMO_PROGRAM_ID.
  // Verifying against the same constant we build with would mean a drifted
  // constant makes a write to the wrong program verify as correct.
  let memoText: string | null = null;
  let usedMemo = false;
  let sawWrongProgram = false;

  // getTransaction may return either a legacy or a v0 message depending on how
  // the transaction was submitted, so both shapes are walked.
  const msg = tx.transaction.message as unknown as {
    instructions?: { programIdIndex: number; data?: Uint8Array }[];
    compiledInstructions?: { programIdIndex: number; data?: Uint8Array }[];
    staticAccountKeys: { toBase58(): string }[];
  };
  const ixs = msg.compiledInstructions ?? msg.instructions ?? [];
  for (const ix of ixs) {
    const pid = msg.staticAccountKeys?.[ix.programIdIndex]?.toBase58();
    if (!pid) continue;
    if (isKnownGoodMemoProgram(pid)) {
      usedMemo = true;
    } else if (pid === MEMO_PROGRAM_ID) {
      // Reachable only if MEMO_PROGRAM_ID drifted from the known-good value.
      sawWrongProgram = true;
    }
    if (ix.data && ix.data.length > 4) {
      memoText = decodeMemoData(Buffer.from(ix.data));
    }
  }

  if (!usedMemo) {
    return {
      ...base,
      status: "FAILED",
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      error: sawWrongProgram
        ? `Transaction invoked ${MEMO_PROGRAM_ID}, which is not the Memo program Dependency Zero ` +
          `recognises (${KNOWN_GOOD_MEMO_PROGRAM_ID}). Refusing to verify it.`
        : `Transaction did not invoke the expected SPL Memo program (${KNOWN_GOOD_MEMO_PROGRAM_ID}).`,
    };
  }
  if (!memoText) {
    return {
      ...base,
      status: "FAILED",
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      memoProgramId: KNOWN_GOOD_MEMO_PROGRAM_ID,
      error: "Could not decode Memo data from the transaction.",
    };
  }

  const anchored = /c=([0-9a-f]{64})/.exec(memoText)?.[1] ?? null;
  const anchoredScan = /scan=([^ |]+)/.exec(memoText)?.[1] ?? null;
  const matches = anchored === params.expectedCommitment && anchoredScan === params.expectedScanId;

  return {
    status: matches ? "VERIFIED" : "FAILED",
    cluster: CLUSTER,
    signature: params.signature,
    anchoredCommitment: anchored,
    memoProgramId: KNOWN_GOOD_MEMO_PROGRAM_ID,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    explorerUrl: explorerTxUrl(params.signature),
    confirmationStatus: "confirmed",
    commitmentMatches: matches,
    error: matches
      ? null
      : `Anchored commitment ${anchored} (scan ${anchoredScan}) does not match expected ${params.expectedCommitment} (scan ${params.expectedScanId}).`,
  };
}

/** Balance in SOL, for operator diagnostics only. Never used in a verdict. */
export async function devnetBalance(connection: Connection, address: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(address);
  return lamports / LAMPORTS_PER_SOL;
}