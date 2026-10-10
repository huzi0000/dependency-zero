#!/usr/bin/env node
/**
 * d0-verify — standalone proof-bundle verifier.
 *
 * Deliberately INDEPENDENT of the Dependency Zero web application:
 *
 *   - it does not import the server store
 *   - it does not call the D0 API
 *   - it holds no private keys
 *   - it does not read the application's own "VERIFIED" badge or status field
 *   - it does not import @solana/web3.js, so nothing it uses to reach Solana
 *     is shared with the code that produced the proof
 *
 * It takes an exported proof bundle, recomputes every commitment itself,
 * verifies every Ed25519 signature against the public keys carried IN the
 * bundle, and then asks Solana Devnet whether the anchored transaction really
 * exists, really succeeded, really used the expected Memo program, and really
 * carries the same commitment.
 *
 * A bundle that claims `confirmed: true` proves nothing on its own; this tool
 * re-derives everything.
 *
 * TERMINATION: the process exits naturally on its own. No `process.exit()` is
 * called, because forcing exit can truncate stdout on a Windows pipe and, more
 * importantly, an abrupt teardown of pooled handles previously crashed Node with
 * a libuv UV_HANDLE_CLOSING assertion (-1073740791) AFTER a successful run.
 * All RPC sockets are opened with `agent: false`, so every connection is closed
 * as soon as its response is read and no handle can outlive the work.
 *
 * Usage:
 *   d0-verify <bundle.json> [--rpc <url>] [--offline]
 *
 * Exit codes (the actual OS exit code, set via process.exitCode):
 *   0  VERIFIED
 *   1  verification failed (tampered, inconsistent, or invalid reference)
 *   2  bundle could not be read/parsed
 *   3  chain verification unavailable (transport) — NOT a pass
 */

import { readFileSync } from "node:fs";
import * as https from "node:https";
import { URL } from "node:url";

import { canonicalizeScannerResult, attestationCommitment, scannersCommitment } from "../lib/attest/canonical.ts";
import { verifySignature } from "../lib/attest/verify-signature.ts";
// Only the decoder is shared. The expected program ID below is deliberately a
// SEPARATE literal rather than an import — see the note on it.
import { decodeMemoData } from "../lib/attest/memo.ts";
import type { ProofBundle } from "../lib/attest/bundle.ts";

/**
 * The only Solana program this verifier will accept as proof of a commitment.
 *
 * DELIBERATELY DUPLICATED as a literal instead of imported from the library.
 * If this tool imported the same constant that builds the instruction, then a
 * single wrong value would make the writer and the reader agree that the wrong
 * program was correct, and the check would be worthless. Independent
 * declaration is what gives the comparison meaning.
 *
 * Value: SPL Memo (v2). Not a Dependency Zero program.
 */
const EXPECTED_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const out = (s = "") => process.stdout.write(`${s}\n`);

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON-RPC over node:https with `agent: false`.
 *
 * `agent: false` means no connection pooling and no keep-alive: the socket is
 * destroyed once the response ends. That is what lets this process terminate
 * cleanly. Using the SDK's Connection instead left pooled handles open, and
 * Node aborted during teardown.
 */
function rpc<T = any>(endpoint: string, method: string, params: unknown[], timeoutMs = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const url = new URL(endpoint);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        agent: false,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              result?: T;
              error?: { message: string };
            };
            if (json.error) reject(new Error(json.error.message));
            else resolve(json.result as T);
          } catch (e) {
            reject(e as Error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("RPC timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Bounded retry for transient transport failures only. */
async function withRetry<T>(fn: () => Promise<T>, tries: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      // A definite answer (including null) is returned immediately; only a
      // thrown transport error is retried.
      return v;
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last as Error;
}

/** Solana base58 decode, implemented here so no SDK is needed. */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58ToBytes(s: string): Buffer {
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

/** A Solana signature is exactly 64 bytes, base58 of a 32-byte pubkey plus 32 bytes. */
function isSignature(s: string): boolean {
  if (typeof s !== "string" || s.length < 80 || s.length > 90) return false;
  try {
    return base58ToBytes(s).length === 64;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const offline = args.includes("--offline");
  const rpcIdx = args.indexOf("--rpc");
  const rpcUrl = rpcIdx !== -1 ? args[rpcIdx + 1] : "https://api.devnet.solana.com";

  if (!file) {
    out(c.bold("d0-verify — independent proof bundle verifier"));
    out();
    out("Usage: d0-verify <bundle.json> [--rpc <url>] [--offline]");
    out();
    out("This tool re-derives every claim in the bundle. It trusts neither the");
    out("Dependency Zero API nor the app's own VERIFIED badge.");
    return 2;
  }

  let bundle: ProofBundle;
  try {
    bundle = JSON.parse(readFileSync(file, "utf8")) as ProofBundle;
  } catch (e) {
    out(c.red(`Could not read bundle: ${(e as Error).message}`));
    return 2;
  }

  out(c.bold("Dependency Zero — independent proof verification"));
  out(c.dim(`  bundle : ${file}`));
  out(c.dim(`  schema : ${bundle.bundleSchema}`));
  out(c.dim(`  scan   : ${bundle.scan.name}@${bundle.scan.version} (${bundle.scan.id.slice(0, 8)}…)`));
  out(c.dim(`  artifact: ${bundle.scan.artifactSha256.slice(0, 24)}…`));
  out();

  const checks: Check[] = [];

  /* ---- 1. Registry integrity ------------------------------------------ */
  checks.push({
    name: "registry is labelled honestly",
    ok: bundle.registry.onChainProgramDeployed === false,
    detail:
      bundle.registry.onChainProgramDeployed === false
        ? "bundle correctly states no on-chain registry program is deployed"
        : "bundle claims an on-chain program that this deployment does not have",
  });

  checks.push({
    name: "trust model disclosure",
    ok: bundle.trustModel.independentOperators === false,
    detail:
      bundle.trustModel.independentOperators === false
        ? "bundle discloses that operators are not independent"
        : "bundle does not disclose operator independence",
  });

  /* ---- 2. Every signature, verified against the bundled public key ------ */
  const byKey = new Map(bundle.registry.entries.map((e) => [e.publicKeyHex, e]));
  for (const s of bundle.scanners) {
    const entry = byKey.get(s.payload.scannerPublicKey);
    if (!entry) {
      checks.push({ name: `signature ${s.payload.scannerRole}`, ok: false, detail: "signer absent from registry" });
      continue;
    }
    if (entry.revoked) {
      checks.push({ name: `signature ${s.payload.scannerRole}`, ok: false, detail: "identity revoked" });
      continue;
    }
    const ok = verifySignature(canonicalizeScannerResult(s.payload), s.signature, entry.publicKeyDer);
    checks.push({
      name: `signature ${s.payload.scannerRole}`,
      ok,
      detail: ok ? "Ed25519 signature verified" : "signature INVALID",
    });
  }

  /* ---- 3. Binding to this artifact and scan ---------------------------- */
  checks.push({
    name: "artifact binding",
    ok: bundle.scanners.every((s) => s.payload.artifactSha256 === bundle.scan.artifactSha256),
    detail: "every signed result is bound to the declared artifact",
  });
  checks.push({
    name: "scan binding",
    ok: bundle.scanners.every((s) => s.payload.scanId === bundle.scan.id),
    detail: "every signed result is bound to the declared scan id",
  });

  /* ---- 4. Recompute the attestation commitment ------------------------ */
  const ts = Date.parse(bundle.generatedAt);
  const recomputed = attestationCommitment({
    scanId: bundle.scan.id,
    resolvedName: bundle.scan.name,
    resolvedVersion: bundle.scan.version,
    artifactSha256: bundle.scan.artifactSha256,
    scannersCommitment: scannersCommitment(bundle.scanners.map((s) => s.payload)),
    consensusResult: bundle.consensus.result,
    consensusPolicyVersion: bundle.consensus.policyVersion,
    registryVersion: bundle.registry.version,
    registryCommitment: null,
    timestamp: Number.isFinite(ts) ? ts : 0,
  });
  checks.push({
    name: "attestation commitment",
    ok: recomputed === bundle.commitment,
    detail:
      recomputed === bundle.commitment
        ? `recomputed ${recomputed.slice(0, 20)}… matches`
        : `recomputed ${recomputed.slice(0, 20)}… ≠ bundle ${bundle.commitment.slice(0, 20)}…`,
  });

  out(c.bold("Offline checks (no network, no application trust)"));
  for (const chk of checks) {
    out(`  ${chk.ok ? c.green("PASS") : c.red("FAIL")}  ${chk.name.padEnd(30)} ${c.dim(chk.detail)}`);
  }

  const offlineOk = checks.every((x) => x.ok);
  out();
  out(`  offline result: ${offlineOk ? c.green("OK") : c.red("FAILED")}`);
  out();

  if (offline) {
    out(offlineOk ? c.green("VERIFIED (offline only — chain not consulted)") : c.red("FAILED"));
    return offlineOk ? 0 : 1;
  }

  /* ---- 5. Ask Solana Devnet ------------------------------------------- */
  out(c.bold("Chain verification (Solana Devnet)"));
  const sig = bundle.attestation.transactionSignature;

  if (!sig) {
    out(`  ${c.yellow("SKIP")}  no transaction signature in bundle`);
    out();
    out(c.yellow("NOT_ATTESTED — nothing was anchored for this scan."));
    return offlineOk ? 0 : 1;
  }

  // A malformed reference is a defective bundle, not an unreachable network.
  // Reporting a forged bundle as "retry later" would understate what we know.
  if (!isSignature(sig)) {
    out(`  ${c.red("FAIL")}  transaction signature is not a valid Solana signature`);
    out(`         ${c.dim(sig.slice(0, 24))}… is ${sig.length} chars, not a 64-byte base58 signature`);
    out();
    out(c.red("  FAILED — the bundle's transaction reference is invalid."));
    return 1;
  }

  let tx: any;
  try {
    tx = await withRetry(
      () =>
        rpc<any>(rpcUrl, "getTransaction", [
          sig,
          { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]),
      4,
    );
  } catch (e) {
    const msg = (e as Error).message;
    const defective = /invalid param|invalid signature|malformed|expected 64 byte/i.test(msg);
    if (defective) {
      out(`  ${c.red("FAIL")}  Solana rejected the transaction reference`);
      out(`         ${c.dim(msg.split("\n")[0])}`);
      out();
      out(c.red("  FAILED — the bundle's transaction reference is invalid."));
      return 1;
    }
    out(`  ${c.yellow("UNAVAILABLE")}  RPC error: ${msg}`);
    out();
    out(c.yellow("UNAVAILABLE — this is NOT a pass. Retry when Devnet RPC is reachable."));
    return 3;
  }

  if (!tx) {
    out(`  ${c.yellow("PENDING")}  transaction not visible at the confirmed commitment`);
    out();
    out(c.yellow("PENDING — this is NOT a pass."));
    return 3;
  }

  out(`  ${c.dim("transaction :")} ${sig}`);
  out(`  ${c.dim("slot        :")} ${tx.slot}`);
  out(`  ${c.dim("blockTime   :")} ${tx.blockTime ?? "n/a"}`);
  out(`  ${c.dim("explorer    :")} https://explorer.solana.com/tx/${sig}?cluster=${bundle.cluster}`);

  const chainChecks: Check[] = [];

  chainChecks.push({
    name: "transaction succeeded",
    ok: !tx.meta?.err,
    detail: tx.meta?.err ? `on-chain error: ${JSON.stringify(tx.meta.err)}` : "no execution error",
  });

  // Walk the compiled instructions. Handles both legacy and v0 messages.
  const msg = tx.transaction.message as any;
  const keys: any[] = msg.accountKeys ?? [];
  const ixs = msg.compiledInstructions ?? msg.instructions ?? [];
  let memoText: string | null = null;
  let usedMemo = false;
  const programsInvoked: string[] = [];
  for (const ix of ixs) {
    const k = keys[ix.programIdIndex];
    const pid = typeof k === "string" ? k : k?.pubkey;
    if (typeof pid !== "string") continue;
    programsInvoked.push(pid);
    if (pid !== EXPECTED_MEMO_PROGRAM) continue;
    usedMemo = true;
    try {
      memoText = decodeMemoData(base58ToBytes(ix.data));
    } catch {
      memoText = null;
    }
  }

  chainChecks.push({
    name: "expected Memo program invoked",
    ok: usedMemo,
    detail: usedMemo
      ? `${EXPECTED_MEMO_PROGRAM}`
      : programsInvoked.length
        ? `transaction invoked ${[...new Set(programsInvoked)].join(", ")} instead of ${EXPECTED_MEMO_PROGRAM}`
        : "transaction invoked no recognisable program",
  });

  // The bundle's declared program must also equal the expected one. A bundle
  // cannot lower the bar by naming a different program it happens to know about.
  chainChecks.push({
    name: "bundle declares the expected program",
    ok: bundle.expectedMemoProgramId === EXPECTED_MEMO_PROGRAM,
    detail:
      bundle.expectedMemoProgramId === EXPECTED_MEMO_PROGRAM
        ? "bundle and verifier agree on the Memo program"
        : `bundle declares ${bundle.expectedMemoProgramId}, verifier requires ${EXPECTED_MEMO_PROGRAM}`,
  });

  const anchored = memoText ? (/c=([0-9a-f]{64})/.exec(memoText)?.[1] ?? null) : null;
  const anchoredScan = memoText ? (/scan=([^ |]+)/.exec(memoText)?.[1] ?? null) : null;

  chainChecks.push({
    name: "on-chain commitment matches",
    ok: anchored === bundle.commitment,
    detail:
      anchored === bundle.commitment
        ? `chain carries ${anchored.slice(0, 20)}…`
        : `chain carries ${anchored?.slice(0, 20) ?? "nothing"}…, bundle declares ${bundle.commitment.slice(0, 20)}…`,
  });

  chainChecks.push({
    name: "on-chain scan id matches",
    ok: anchoredScan === bundle.scan.id,
    detail: anchoredScan === bundle.scan.id ? "scan id matches" : `chain scan ${anchoredScan} ≠ ${bundle.scan.id}`,
  });

  for (const chk of chainChecks) {
    out(`  ${chk.ok ? c.green("PASS") : c.red("FAIL")}  ${chk.name.padEnd(30)} ${c.dim(chk.detail)}`);
  }

  const chainOk = chainChecks.every((x) => x.ok);
  const allOk = offlineOk && chainOk;

  out();
  if (allOk) {
    out(c.green("  VERIFIED — signatures valid, commitment recomputed, and the"));
    out(c.green("  same commitment is anchored in a confirmed Solana Devnet transaction."));
    return 0;
  }
  out(c.red("  FAILED — the proof bundle does not hold up."));
  return 1;
}

main()
  .then((code) => {
    // Set the exit code and let the event loop drain naturally. No process.exit().
    process.exitCode = code;
  })
  .catch((e) => {
    out(c.red(`internal error: ${(e as Error).message}`));
    process.exitCode = 1;
  });