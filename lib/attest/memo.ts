/**
 * Solana Memo encoding — deliberately free of any SDK import.
 *
 * Both the Next.js server and the standalone `d0-verify` command need to
 * encode and decode the same Memo payload. When that logic lived inside a
 * module that imported `@solana/web3.js`, the CLI inherited the SDK's
 * connection pool and crashed during Windows process teardown with a libuv
 * `UV_HANDLE_CLOSING` assertion (exit -1073740791).
 *
 * Keeping the encoding pure fixes that at the source: the verifier now needs
 * no SDK at all, which also makes it a genuinely independent implementation
 * rather than a copy of the application's own networking path.
 */

/** Well-known SPL Memo program used for commitments. */
/**
 * The program used to build commitments.
 *
 * NOTE: this is the value we CONSTRUCT instructions against. It is deliberately
 * not the value we VALIDATE against — see KNOWN_GOOD_MEMO_PROGRAM_ID. Having a
 * single constant serve both roles means a wrong value would be silently
 * accepted by the writer and the verifier at the same time, and both would agree
 * that the wrong program was correct.
 */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/**
 * The only Memo program Dependency Zero will ever attest to.
 *
 * Asserted independently of MEMO_PROGRAM_ID at every boundary: instruction
 * construction, on-chain verification, and the standalone verifier. If the
 * build constant ever drifts, every one of those fails closed instead of
 * quietly verifying the wrong program.
 *
 * Value: SPL Memo (v2), a well-known Solana program. It is NOT a
 * Dependency Zero program; see docs/TRUST_MODEL.md.
 */
export const KNOWN_GOOD_MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** The exact label shown wherever a Memo commitment is described. */
export const MECHANISM_LABEL = "Solana Devnet commitment anchored via Memo";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58-decode to raw bytes without importing an SDK. */
export function base58ToBytes(s: string): Buffer {
  const bytes: number[] = [0];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error(`invalid base58 character: ${ch}`);
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

/**
 * True when `programId` is the Memo program Dependency Zero recognises.
 *
 * Checks two independent things:
 *   1. it decodes from base58 to exactly 32 bytes (a real ed25519 pubkey), and
 *   2. it equals KNOWN_GOOD_MEMO_PROGRAM_ID byte-for-byte.
 *
 * Both are required. A well-formed but wrong address, or a malformed one, both
 * fail.
 */
export function isKnownGoodMemoProgram(programId: string, expected: string = KNOWN_GOOD_MEMO_PROGRAM_ID): boolean {
  if (typeof programId !== "string" || programId !== expected) return false;
  try {
    return base58ToBytes(programId).length === 32;
  } catch {
    return false;
  }
}

/**
 * Fail closed unless `programId` is the recognised Memo program.
 *
 * Used on the write path so we never construct an instruction aimed at an
 * unverified program. Throwing is deliberate: silently building it anyway would
 * let a constant drift turn every attestation into a write to the wrong place.
 */
export function assertKnownGoodMemoProgram(programId: string, expected: string = KNOWN_GOOD_MEMO_PROGRAM_ID): void {
  if (!isKnownGoodMemoProgram(programId, expected)) {
    throw new Error(
      `Refusing to use Memo program ${programId}: Dependency Zero only attests to ` +
        `${expected}. This is a configuration error and must not be worked around.`,
    );
  }
}

/**
 * Encode the Memo payload for instruction data.
 *
 * ENCODING, established empirically against Devnet by simulation, not assumed:
 *
 * The Memo program at MEMO_PROGRAM_ID expects RAW UTF-8 instruction data. It
 * does NOT use the bincode `Memo { data: String }` length-prefixed form that
 * Memo v1 uses.
 *
 * Sending the v1 form is rejected. The program decodes byte 0 of the data as
 * UTF-8; a length prefix for a 226-byte memo begins with 0xE2, which is not
 * valid UTF-8, and the transaction fails with:
 *
 *   InstructionError [0, "InvalidInstructionData"]
 *   log: Program log: Invalid UTF-8, from byte 0
 *
 * The accepted form, confirmed from Devnet program logs:
 *   Program log: Memo (len 226): "D0/d0-attestation/1 | c=57a6579d... | ..."
 */
export function encodeMemoData(memoText: string): Buffer {
  return Buffer.from(memoText, "utf8");
}

/**
 * Decode Memo instruction data back to its UTF-8 string.
 *
 * Both observed encodings are handled: the raw UTF-8 form the v2 program
 * actually uses, and the v1 bincode form, recognised by an exact leading
 * length. Being tolerant here costs nothing, because verification compares the
 * parsed commitment against a hash recomputed locally — a wrong decode yields
 * a mismatch, never a false pass.
 */
export function decodeMemoData(data: Buffer): string | null {
  try {
    if (data.length >= 4) {
      const len = data.readUInt32LE(0);
      if (len > 0 && 4 + len === data.length) {
        return data.subarray(4).toString("utf8");
      }
    }
    return data.toString("utf8");
  } catch {
    return null;
  }
}

export const CLUSTER = "devnet";
export const DEVNET_RPC = "https://api.devnet.solana.com";

/** Explorer deep link. Built only from a signature that actually exists. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
}