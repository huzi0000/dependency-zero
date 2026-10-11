import "server-only";

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DATA_DIR } from "@/lib/config";
import type { ScannerRole } from "./canonical.ts";
import { verifySignature } from "./verify-signature.ts";

// Re-exported so server callers have a single import site. Signing stays here;
// verification lives in the secret-free module so the standalone CLI can use it.
export { verifySignature };

/**
 * Server-side Ed25519 scanner identities.
 *
 * KEY HANDLING RULES (these are the whole point of this module):
 *
 *  - Private keys NEVER live in the repository. They are written to the OS
 *    application-data directory, outside the project tree, under `keys/`.
 *  - Private keys NEVER reach the browser. This module is `server-only`, so the
 *    Next.js client/server boundary rejects any import from a component.
 *  - Keys are generated on first use, never committed, and never logged.
 *  - On POSIX the key file is chmod 0600 and the directory 0700.
 *  - Nothing in this module ever returns a private key to a caller. Callers get
 *    a public key, or a signature.
 *
 * TRUST MODEL — stated plainly: these three keys are generated and held by ONE
 * operator on ONE machine. Three signatures therefore prove internal consistency
 * and tamper-evidence, NOT independent third-party verification. This is a
 * locally operated multi-scanner prototype. See docs/TRUST_MODEL.md.
 */

const KEY_DIR = join(DATA_DIR, "keys");
const KEY_FILE = join(KEY_DIR, "scanner-identities.json");

export interface ScannerIdentity {
  role: ScannerRole;
  /** base58-looking hex of the 32 raw Ed25519 public key bytes. */
  publicKeyHex: string;
  /** DER SPKI public key, base64. Portable key representation. */
  publicKeyDer: string;
  createdAt: string;
}

interface StoredIdentity extends ScannerIdentity {
  /** PKCS#8 DER private key, base64. Never leaves this module. */
  privateKeyDer: string;
}

function b64(buf: Buffer): string {
  return buf.toString("base64");
}

function unb64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

/** Extract the 32 raw Ed25519 public key bytes from a DER SPKI key. */
function rawPublicKey(spki: Buffer): Buffer {
  // SPKI for Ed25519 is a fixed 12-byte prefix followed by the raw key.
  return spki.subarray(spki.length - 32);
}

function ensureKeyDir(): void {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(KEY_DIR, 0o700);
  } catch {
    // Windows and some filesystems do not honour POSIX modes. Documented, not
    // silently ignored: the key file is still outside the repo and unreadable
    // by the web tier.
  }
}

function writeRestricted(file: string, contents: string): void {
  writeFileSync(file, contents, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* see ensureKeyDir */
  }
}

/**
 * Load identities, generating them on first run.
 *
 * Generation is idempotent: the file is created once and then reused, so a
 * scanner keeps a stable public key across restarts and previously signed
 * results remain verifiable.
 */
function loadIdentities(): StoredIdentity[] {
  ensureKeyDir();

  /**
   * Distinguish a first run from key loss.
   *
   * `hadKeyDir` is captured before `ensureKeyDir()` may create it, so an
   * existing key directory with a missing or unreadable key file is treated as
   * LOSS rather than as a fresh install. Fresh generation is silent; replacing
   * keys that previously signed evidence is warned about loudly, because every
   * result signed by the old keys stops being verifiable against a registry
   * built from the new ones.
   *
   * Regeneration is still permitted, because refusing would leave a deployment
   * permanently unable to scan after a volume problem. The warning is the
   * control, and `docs/DEPLOYMENT.md` covers mounting persistent storage.
   */
  const hadKeyDir = existsSync(KEY_DIR);

  if (existsSync(KEY_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(KEY_FILE, "utf8")) as StoredIdentity[];
      if (Array.isArray(parsed) && parsed.length === 3) return parsed;
    } catch {
      if (hadKeyDir) {
        console.warn(
          "[dependency-zero] The signing key file at " +
            KEY_FILE +
            " exists but could not be read. New keys will be generated. Any evidence" +
            " previously signed by the old keys will no longer verify against this registry.",
        );
      }
    }
  } else if (hadKeyDir) {
    console.warn(
      "[dependency-zero] The key directory " +
        KEY_DIR +
        " exists but contains no signing keys. New keys will be generated. If this host" +
        " previously scanned anything, previously signed evidence will no longer verify" +
        " against this registry. Mount persistent storage for DATA_DIR to avoid this.",
    );
  }

  const now = new Date().toISOString();
  const roles: ScannerRole[] = ["static_lifecycle", "dependency_advisory", "artifact_integrity"];

  const generated: StoredIdentity[] = roles.map((role) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
    return {
      role,
      publicKeyHex: rawPublicKey(spki).toString("hex"),
      publicKeyDer: b64(spki),
      privateKeyDer: b64(pkcs8),
      createdAt: now,
    };
  });

  writeRestricted(KEY_FILE, JSON.stringify(generated, null, 2));
  return generated;
}

let cache: StoredIdentity[] | null = null;

function identities(): StoredIdentity[] {
  if (!cache) cache = loadIdentities();
  return cache;
}

/** Public identity for a role. Safe to expose to the server-rendered UI. */
export function publicIdentity(role: ScannerRole): ScannerIdentity {
  const found = identities().find((i) => i.role === role);
  if (!found) throw new Error(`No scanner identity for role ${role}`);
  const { privateKeyDer: _secret, ...pub } = found;
  return pub;
}

export function allPublicIdentities(): ScannerIdentity[] {
  return identities().map(({ privateKeyDer: _secret, ...pub }) => pub);
}

/** Where keys live. Exposed so operators can provision or inspect them. */
export function keyStoreLocation(): string {
  return KEY_FILE;
}

/**
 * Sign bytes with a role's private key.
 *
 * The only path in the codebase that can produce a signature. The private key
 * is loaded here and never returned.
 */
export function signWithRole(role: ScannerRole, payload: Buffer): string {
  const found = identities().find((i) => i.role === role);
  if (!found) throw new Error(`No scanner identity for role ${role}`);
  const key = createPrivateKey({ key: unb64(found.privateKeyDer), format: "der", type: "pkcs8" });
  return edSign(null, payload, key).toString("hex");
}
