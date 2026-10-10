/**
 * Attestation, consensus and commitment tests.
 *
 * Deterministic and fully offline: the Solana layer is exercised against an
 * injected fake connection so no test touches the network and no test can
 * accidentally report success it did not achieve.
 */

import assert from "node:assert/strict";
import { createPrivateKey, createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { describe, it } from "node:test";

import {
  attestationCommitment,
  canonicalizeFindings,
  canonicalizeScannerResult,
  findingsCommitment,
  memoPayload,
  scannersCommitment,
  SCHEMA_VERSION,
} from "../lib/attest/canonical.ts";
import { verifySignature } from "../lib/attest/verify-signature.ts";
import {
  computeConsensus,
  CONSENSUS_POLICY_VERSION,
  REQUIRED_QUORUM,
  type RegistryEntry,
  type SignedScannerResult,
} from "../lib/attest/consensus.ts";
import type { ScannerRole } from "../lib/attest/canonical.ts";
import { buildProofBundle, verifyBundleOffline } from "../lib/attest/bundle.ts";
import { decodeMemoData, idempotencyKeyFor, memoInstruction } from "../lib/attest/solana.ts";
import {
  KNOWN_GOOD_MEMO_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  isKnownGoodMemoProgram,
} from "../lib/attest/memo.ts";
import { readFileSync } from "node:fs";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  return {
    publicKeyHex: spki.subarray(spki.length - 32).toString("hex"),
    publicKeyDer: spki.toString("base64"),
    privateKeyDer: pkcs8.toString("base64"),
  };
}

/** Decode a base64 DER key without tripping Buffer's strict overloads. */
function fromB64(s: string): Buffer {
  return Buffer.from(s, "base64") as Buffer;
}

/** Load a PKCS#8 Ed25519 private key from base64 DER. */
function loadKey(b64: string) {
  return createPrivateKey({ key: fromB64(b64), format: "der", type: "pkcs8" });
}

function registryEntry(role: ScannerRole, key = makeKey()): RegistryEntry & { _k: ReturnType<typeof makeKey> } {
  return {
    publicKeyHex: key.publicKeyHex,
    publicKeyDer: key.publicKeyDer,
    role,
    registeredAt: "2026-01-01T00:00:00.000Z",
    registryVersion: 1,
    revoked: false,
    operator: "local-operator (single machine)",
    _k: key,
  };
}

function payloadFor(
  role: ScannerRole,
  key: { publicKeyHex: string },
  over: Partial<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: SCHEMA_VERSION,
    domain: "DEPENDENCY-ZERO/ATTESTATION",
    scanId: "scan-1",
    resolvedName: "pkg",
    resolvedVersion: "1.0.0",
    artifactSha256: "a".repeat(64),
    scannerPublicKey: key.publicKeyHex,
    scannerRole: role,
    scannerVersion: "d0-scanner/2.0.0",
    policyVersion: "d0-policy/1.0.0",
    findingsCommitment: "b".repeat(64),
    findingCount: 0,
    proposedVerdict: "allow" as const,
    riskScore: 0,
    completionStatus: "completed" as const,
    timestamp: 1760000000000,
    ...over,
  };
}

function signed(
  role: ScannerRole,
  entry: { _k: ReturnType<typeof makeKey>; publicKeyHex: string },
  over: Partial<Record<string, unknown>> = {},
): SignedScannerResult {
  const p = payloadFor(role, entry, over);
  const key = loadKey(entry._k.privateKeyDer);
  return {
    payload: p,
    signature: edSign(null, canonicalizeScannerResult(p), key).toString("hex"),
  };
}

function fullSet(
  verdict: "allow" | "review" | "block" = "allow",
  over: Partial<Record<string, unknown>> = {},
) {
  const roles: ScannerRole[] = ["static_lifecycle", "dependency_advisory", "artifact_integrity"];
  const entries = roles.map((r) => registryEntry(r));
  const results = entries.map((e) => signed(e.role, e, { proposedVerdict: verdict, ...over }));
  return { entries, results, registry: entries.map(({ _k, ...r }) => r) };
}

/* -------------------------------------------------------------------------- */

describe("canonical serialization", () => {
  it("is byte-stable for identical input", () => {
    const p = payloadFor("static_lifecycle", { publicKeyHex: "ff" });
    assert.ok(canonicalizeScannerResult(p).equals(canonicalizeScannerResult(p)));
  });

  it("changes when the verdict changes", () => {
    const a = payloadFor("static_lifecycle", { publicKeyHex: "ff" });
    const b = payloadFor("static_lifecycle", { publicKeyHex: "ff" }, { proposedVerdict: "block" });
    assert.ok(!canonicalizeScannerResult(a).equals(canonicalizeScannerResult(b)));
  });

  it("changes when the artifact hash changes", () => {
    const a = payloadFor("static_lifecycle", { publicKeyHex: "ff" });
    const b = payloadFor("static_lifecycle", { publicKeyHex: "ff" }, { artifactSha256: "c".repeat(64) });
    assert.ok(!canonicalizeScannerResult(a).equals(canonicalizeScannerResult(b)));
  });

  it("is order-independent for findings commitments", () => {
    const f1 = { ruleId: "D0-A", severity: "high", confidence: "high", kind: "heuristic", title: "t", evidenceFile: "a.js", evidenceLine: 1, evidenceSnippet: "x" };
    const f2 = { ruleId: "D0-B", severity: "low", confidence: "low", kind: "heuristic", title: "t", evidenceFile: "b.js", evidenceLine: 2, evidenceSnippet: "y" };
    assert.equal(findingsCommitment([f1, f2]), findingsCommitment([f2, f1]));
  });

  it("changes when a finding snippet changes", () => {
    const base = { ruleId: "D0-A", severity: "high", confidence: "high", kind: "heuristic", title: "t", evidenceFile: "a.js", evidenceLine: 1, evidenceSnippet: "curl" };
    const other = { ...base, evidenceSnippet: "wget" };
    assert.notEqual(findingsCommitment([base]), findingsCommitment([other]));
  });

  it("does not collide on adjacent field boundaries", () => {
    const a = canonicalizeFindings([
      { ruleId: "R", severity: "s", confidence: "c", kind: "k", title: "ab", evidenceFile: "c", evidenceLine: null, evidenceSnippet: "" },
    ]);
    const b = canonicalizeFindings([
      { ruleId: "R", severity: "s", confidence: "c", kind: "k", title: "a", evidenceFile: "bc", evidenceLine: null, evidenceSnippet: "" },
    ]);
    assert.notEqual(a.toString("hex"), b.toString("hex"));
  });
});

describe("signatures", () => {
  it("accepts a genuine signature and rejects a one-byte modification", () => {
    const e = registryEntry("static_lifecycle");
    const p = payloadFor("static_lifecycle", e);
    const bytes = canonicalizeScannerResult(p);
    const key = loadKey(e._k.privateKeyDer);
    const sig = edSign(null, bytes, key).toString("hex");

    assert.equal(verifySignature(bytes, sig, e.publicKeyDer), true);

    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 2] ^= 0x01;
    assert.equal(verifySignature(tampered, sig, e.publicKeyDer), false);
  });

  it("rejects a signature made by a different key", () => {
    const a = registryEntry("static_lifecycle");
    const b = makeKey();
    const p = payloadFor("static_lifecycle", a);
    const bytes = canonicalizeScannerResult(p);
    const key = loadKey(b.privateKeyDer);
    const sig = edSign(null, bytes, key).toString("hex");
    assert.equal(verifySignature(bytes, sig, a.publicKeyDer), false);
  });

  it("returns false rather than throwing on malformed input", () => {
    const bytes = Buffer.from("x");
    assert.equal(verifySignature(bytes, "not-hex", "not-base64"), false);
  });
});

describe("consensus", () => {
  it("three valid compatible votes produce verified ALLOW", () => {
    const { registry, results, entries } = fullSet("allow");
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.equal(c.verified, true);
    assert.equal(c.result, "allow");
    assert.equal(c.quorumMet, REQUIRED_QUORUM);
    assert.equal(c.rejected.length, 0);
    assert.deepEqual(c.unavailableRoles, []);
  });

  it("one BLOCK with two ALLOW still blocks (not outvoted)", () => {
    const { registry, results, entries } = fullSet("allow");
    // Re-sign so the BLOCK is a genuine, validly signed vote rather than a
    // tampered payload (which would be rejected for a different reason).
    const e0 = entries.find((r) => r.role === "static_lifecycle")!;
    results[0].payload.proposedVerdict = "block";
    results[0].signature = edSign(
      null,
      canonicalizeScannerResult(results[0].payload),
      loadKey(e0._k.privateKeyDer),
    ).toString("hex");
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.equal(c.result, "block", "a BLOCK must never be outvoted into ALLOW");
    assert.equal(c.blockOverride, true);
  });

  it("a missing scanner breaks quorum and cannot yield ALLOW", () => {
    const { registry, results, entries } = fullSet("allow");
    const c = computeConsensus({
      results: results.slice(0, 2),
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.equal(c.quorumMet, 2);
    assert.equal(c.verified, false);
    assert.notEqual(c.result, "allow");
    assert.equal(c.unavailableRoles.length, 1);
  });

  it("an unavailable scanner is represented as unavailable, not approving", () => {
    const { registry, results, entries } = fullSet("allow");
    const c = computeConsensus({
      results: results.slice(0, 2),
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.equal(c.unavailableRoles.length, 1);
    assert.ok(c.rationale.includes("Unavailable roles"));
  });

  it("rejects a duplicate signer", () => {
    const { registry, results, entries } = fullSet("allow");
    const dup = { ...results[0] };
    const c = computeConsensus({
      results: [...results, dup],
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "duplicate_identity"));
  });

  it("rejects a forged signature", () => {
    const { registry, results, entries } = fullSet("allow");
    results[0].signature = "00".repeat(64);
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "bad_signature"));
    assert.equal(c.verified, false);
    assert.notEqual(c.result, "allow");
  });

  it("rejects a result bound to a different artifact hash", () => {
    const { registry, results, entries } = fullSet("allow");
    results[1].payload.artifactSha256 = "d".repeat(64);
    // Re-sign so only the artifact binding is wrong.
    const e = entries.find((r) => r.role === "dependency_advisory")!;
    const key = loadKey(e._k.privateKeyDer);
    results[1].signature = edSign(null, canonicalizeScannerResult(results[1].payload), key).toString("hex");

    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "artifact_mismatch"));
  });

  it("rejects tampered evidence (payload edited after signing)", () => {
    const { registry, results, entries } = fullSet("allow");
    results[2].payload.riskScore = 99; // signature no longer matches
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "bad_signature"));
  });

  it("rejects an unknown identity", () => {
    const { registry, results, entries } = fullSet("allow");
    const stranger = registryEntry("static_lifecycle", makeKey());
    const c = computeConsensus({
      results: [...results, signed(stranger.role, stranger)],
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "unknown_identity"));
  });

  it("rejects a revoked identity", () => {
    const { registry, results, entries } = fullSet("allow");
    const revoked = registry.map((r) =>
      r.role === "dependency_advisory" ? { ...r, revoked: true } : r,
    );
    const c = computeConsensus({
      results,
      registry: revoked,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "revoked_identity"));
    assert.equal(c.verified, false);
  });

  it("flags conflicting scanner versions rather than merging blindly", () => {
    const { registry, results, entries } = fullSet("allow");
    results[1].payload.scannerVersion = "d0-scanner/1.0.0";
    const e = entries.find((r) => r.role === "dependency_advisory")!;
    const key = loadKey(e._k.privateKeyDer);
    results[1].signature = edSign(null, canonicalizeScannerResult(results[1].payload), key).toString("hex");

    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.equal(c.verified, false);
    assert.notEqual(c.result, "allow");
  });

  it("an incomplete scanner result is not an approving vote", () => {
    const { registry, results, entries } = fullSet("allow", { completionStatus: "failed" });
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.ok(c.rejected.some((r) => r.reason === "incomplete_result"));
  });

  it("records an explicit policy version", () => {
    const { registry, results, entries } = fullSet();
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
    });
    assert.equal(c.policyVersion, CONSENSUS_POLICY_VERSION);
  });

  /**
   * Regression test for a real defect found during the express@4.18.2 run.
   *
   * Scanner B held two medium advisories (risk 18, below the review threshold
   * of 25) and Scanner A one low-severity source finding (risk 9). Each
   * partition legitimately evaluated to ALLOW, so quorum reported ALLOW while
   * the authoritative policy over the complete finding set returned REVIEW.
   * The consensus then contradicted the security verdict.
   */
  it("never reports a verdict more permissive than the security verdict", () => {
    const { registry, results, entries } = fullSet("allow");
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
      securityVerdict: "review",
    });
    assert.equal(c.result, "review", "quorum must not report ALLOW when security says REVIEW");
    assert.ok(c.rationale.includes("clamped"), c.rationale);
  });

  it("keeps a stricter vote when the security verdict is more permissive", () => {
    const { registry, results, entries } = fullSet("block");
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
      securityVerdict: "allow",
    });
    assert.equal(c.result, "block", "consensus must never relax a stricter verdict");
  });

  it("leaves an agreeing verdict untouched", () => {
    const { registry, results, entries } = fullSet("allow");
    const c = computeConsensus({
      results,
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
      securityVerdict: "allow",
    });
    assert.equal(c.result, "allow");
    assert.ok(!c.rationale.includes("clamped"));
  });

  it("the clamp still applies when quorum was not met", () => {
    const { registry, results, entries } = fullSet("allow");
    const c = computeConsensus({
      results: results.slice(0, 1),
      registry,
      expectedScanId: "scan-1",
      expectedArtifactSha256: "a".repeat(64),
      expectedName: "pkg",
      expectedVersion: "1.0.0",
      securityVerdict: "block",
    });
    assert.equal(c.result, "block");
  });
});

describe("attestation commitment", () => {
  const base = {
    scanId: "scan-1",
    resolvedName: "pkg",
    resolvedVersion: "1.0.0",
    artifactSha256: "a".repeat(64),
    scannersCommitment: "b".repeat(64),
    consensusResult: "allow",
    consensusPolicyVersion: CONSENSUS_POLICY_VERSION,
    registryVersion: 1,
    registryCommitment: null,
    timestamp: 1760000000000,
  };

  it("is deterministic", () => {
    assert.equal(attestationCommitment(base), attestationCommitment({ ...base }));
  });

  it("changes when the consensus result changes", () => {
    assert.notEqual(attestationCommitment(base), attestationCommitment({ ...base, consensusResult: "block" }));
  });

  it("changes when a vote commitment changes", () => {
    assert.notEqual(attestationCommitment(base), attestationCommitment({ ...base, scannersCommitment: "c".repeat(64) }));
  });

  it("changes when the artifact changes", () => {
    assert.notEqual(attestationCommitment(base), attestationCommitment({ ...base, artifactSha256: "d".repeat(64) }));
  });

  it("changes when the scan id changes (replay protection)", () => {
    assert.notEqual(attestationCommitment(base), attestationCommitment({ ...base, scanId: "scan-2" }));
  });

  it("scanners commitment is order independent", () => {
    const { registry, results, entries } = fullSet();
    const forwards = scannersCommitment(results.map((r) => r.payload));
    const backwards = scannersCommitment([...results].reverse().map((r) => r.payload));
    assert.equal(forwards, backwards);
  });
});

describe("proof bundle", () => {
  function bundle(over: Record<string, unknown> = {}) {
    const { registry, results, entries } = fullSet("allow");
    const ts = 1760000000000;
    return buildProofBundle({
      scanId: "scan-1",
      name: "pkg",
      version: "1.0.0",
      artifactSha256: "a".repeat(64),
      registry: "https://registry.npmjs.org",
      registryEntries: registry,
      registryCommitment: "e".repeat(64),
      registryVersion: 1,
      operator: "local-operator (single machine)",
      scanners: results,
      consensus: computeConsensus({
        results,
        registry,
        expectedScanId: "scan-1",
        expectedArtifactSha256: "a".repeat(64),
        expectedName: "pkg",
        expectedVersion: "1.0.0",
      }),
      attestation: {
        schemaVersion: SCHEMA_VERSION,
        mechanism: "spl-memo",
        mechanismLabel: "Solana Devnet commitment anchored via Memo",
        cluster: "devnet",
        commitmentHash: "",
        scanId: "scan-1",
        artifactSha256: "a".repeat(64),
        status: "not_started",
        transactionSignature: null,
        slot: null,
        confirmationStatus: null,
        blockTime: null,
        explorerUrl: null,
        submittedAt: null,
        confirmedAt: null,
        confirmed: false,
        error: null,
        memoData: null,
        memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        idempotencyKey: "k",
      },
      timestamp: ts,
      ...over,
    });
  }

  it("carries no private key material", () => {
    const b = bundle();
    const text = JSON.stringify(b);
    assert.ok(!text.includes("privateKey"), "bundle must not contain private key fields");
    assert.ok(!text.includes("PRIVATE KEY"));
  });

  it("discloses non-independence of operators", () => {
    assert.equal(bundle().trustModel.independentOperators, false);
    assert.equal(bundle().registry.onChainProgramDeployed, false);
  });

  it("verifies offline for an untampered bundle", () => {
    const r = verifyBundleOffline(bundle());
    assert.equal(r.ok, true, JSON.stringify(r.checks));
  });

  it("fails offline when the artifact hash is tampered", () => {
    const b = bundle();
    b.scan.artifactSha256 = "f".repeat(64);
    assert.equal(verifyBundleOffline(b).ok, false);
  });

  it("fails offline when a vote is changed after signing", () => {
    const b = bundle();
    b.scanners[0].payload.proposedVerdict = "block";
    assert.equal(verifyBundleOffline(b).ok, false);
  });

  it("fails offline when a signature is altered", () => {
    const b = bundle();
    b.scanners[1].signature = "00".repeat(64);
    assert.equal(verifyBundleOffline(b).ok, false);
  });

  it("fails offline when the declared commitment is edited", () => {
    const b = bundle();
    b.commitment = "0".repeat(64);
    assert.equal(verifyBundleOffline(b).ok, false);
  });
});

describe("memo encoding", () => {
  it("round-trips through the instruction data", () => {
    const text = memoPayload({
      commitment: "a".repeat(64),
      scanId: "scan-1",
      artifactSha256: "b".repeat(64),
      consensus: "allow",
    });
    const ix = memoInstruction(text);
    assert.equal(decodeMemoData(Buffer.from(ix.data)), text);
  });

  /**
   * Regression test for a real rejection on Devnet.
   *
   * The v1 bincode form (4-byte LE length + UTF-8) was rejected by the Memo v2
   * program with `InvalidInstructionData` and the log
   * `Invalid UTF-8, from byte 0`, because the program decodes the instruction
   * data as RAW UTF-8 with no length prefix.
   */
  it("encodes as raw UTF-8 with no length prefix", () => {
    const ix = memoInstruction("hello");
    assert.deepEqual(
      Buffer.from(ix.data),
      Buffer.from("hello", "utf8"),
      "memo data must be raw UTF-8, not length-prefixed",
    );
  });

  it("decodes both the raw and the v1 length-prefixed form", () => {
    const text = "D0/d0-attestation/1 | c=deadbeef";
    const raw = Buffer.from(text, "utf8");
    const prefixed = Buffer.alloc(4 + raw.length);
    prefixed.writeUInt32LE(raw.length, 0);
    raw.copy(prefixed, 4);

    assert.equal(decodeMemoData(raw), text);
    assert.equal(decodeMemoData(prefixed), text);
  });

  it("produces a deterministic idempotency key", () => {
    assert.equal(idempotencyKeyFor("s", "c"), idempotencyKeyFor("s", "c"));
    assert.notEqual(idempotencyKeyFor("s", "c"), idempotencyKeyFor("s", "d"));
  });

  it("targets the well-known SPL Memo program", () => {
    const ix = memoInstruction("hello");
    assert.equal(ix.programId.toBase58(), "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  });

  /**
   * Regression test: the Memo program Dependency Zero attests to.
   *
   * Both constants are pinned separately because they serve different roles.
   * MEMO_PROGRAM_ID is what instructions are BUILT against;
   * KNOWN_GOOD_MEMO_PROGRAM_ID is what the verifier ACCEPTS. If one silently
   * changed, the build and the check would drift apart — that is exactly what
   * these assertions exist to prevent.
   */
  it("pins the SPL Memo program id", () => {
    assert.equal(MEMO_PROGRAM_ID, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    assert.equal(KNOWN_GOOD_MEMO_PROGRAM_ID, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  });

  it("pins the program id independently in the standalone verifier", () => {
    // The CLI declares its own literal rather than importing ours. Read the
    // source and confirm that literal is present and that MEMO_PROGRAM_ID is
    // not used as the expected value there.
    const src = readFileSync(new URL("../cli/d0-verify.ts", import.meta.url), "utf8");
    const m = /const EXPECTED_MEMO_PROGRAM\s*=\s*"([^"]+)"/.exec(src);
    assert.ok(m, "d0-verify must declare its own EXPECTED_MEMO_PROGRAM literal");
    assert.equal(m[1], "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    assert.ok(
      !/import[^;]*MEMO_PROGRAM_ID[^;]*from "\.\.\/lib\/attest\/memo\.ts"/s.test(src),
      "d0-verify must not import the shared build constant as its expected value",
    );
  });

  it("accepts only the known-good program id", () => {
    assert.equal(isKnownGoodMemoProgram(KNOWN_GOOD_MEMO_PROGRAM_ID), true);
    // Well-formed base58 but a different, real 32-byte address.
    assert.equal(isKnownGoodMemoProgram("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"), false);
    assert.equal(isKnownGoodMemoProgram("11111111111111111111111111111111"), false);
    assert.equal(isKnownGoodMemoProgram("not-a-program"), false);
    assert.equal(isKnownGoodMemoProgram(""), false);
  });

  it("fails closed when building an instruction for an unexpected program", () => {
    assert.throws(
      () => memoInstruction("hello", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"),
      /Refusing to use Memo program/,
      "a wrong program must abort instruction construction, not be written anyway",
    );
    assert.throws(() => memoInstruction("hello", "garbage"), /Refusing to use Memo program/);
    // The correct program still builds.
    assert.equal(memoInstruction("hello", KNOWN_GOOD_MEMO_PROGRAM_ID).programId.toBase58(), KNOWN_GOOD_MEMO_PROGRAM_ID);
  });
});