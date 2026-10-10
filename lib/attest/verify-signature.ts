import { createPublicKey, verify as edVerify } from "node:crypto";

/**
 * Signature verification, deliberately free of secrets.
 *
 * This module imports NO private keys and NO `server-only`, so the standalone
 * `d0-verify` CLI can use it to check a proof bundle against a public key it
 * was handed, without any access to the application's key material.
 */

function unb64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

/**
 * Verify an Ed25519 signature over raw payload bytes.
 *
 * Any malformed input returns false rather than throwing. A verifier that
 * throws on hostile input risks a caller treating the exception as "could not
 * verify" and, worse, one that defaults to true.
 */
export function verifySignature(
  payload: Buffer,
  signatureHex: string,
  publicKeyDer: string,
): boolean {
  try {
    const key = createPublicKey({ key: unb64(publicKeyDer), format: "der", type: "spki" });
    return edVerify(null, payload, key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
