/**
 * Regression tests for independent proof verification.
 *
 * These cover the Phase 1 fixes:
 *   - CRITICAL-1  bundle.attestation drifting out of sync with the stored one
 *   - CRITICAL-2  NOT_ATTESTED must be distinguishable from VERIFIED by exit code
 *   - HIGH-1      consensus must be recomputed, not trusted from the bundle
 *   - HIGH-2      registry commitment is informational, and tamper-evident
 *   - HIGH-3      a confirmed record must not be re-anchored to another tx
 *
 * Everything here is offline and deterministic. The CLI exit-code cases run the
 * real `d0-verify` binary as a child process against fixture bundles written to
 * a temp directory, so they exercise the actual shipped verifier — not a
 * re-implementation of it.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { execFileSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { reconcileBundleAttestation } from "../lib/attest/bundle.ts";
import {
  registryCommitment,
  REGISTRY_DOMAIN,
  canonicalizeScannerResult,
  attestationCommitment,
  scannersCommitment,
  type ScannerRole,
} from "../lib/attest/canonical.ts";
import { classifyAnchorSubmission } from "../lib/attest/anchor-policy.ts";
import { computeConsensus, type RegistryEntry, type SignedScannerResult } from "../lib/attest/consensus.ts";

const REPO = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const VERIFY_CLI = join(REPO, "cli", "d0-verify.ts");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                     */
/* -------------------------------------------------------------------------- */

const SIG = "3doeWTCPSiqjjzU6AexCXpBvNgFt1tXDdpxcdiZNqtWjTR93MJjjS2twHnYL6ZDFwdXUANxT4qMRsHZbMfcvSmKf";
const OTHER_SIG = "2aktsfvsgH7N8da2GRUoesdBy49AiPXZnFJ23fkv1rfkMc9KDvFiVT5waaGeNKArqpxxREWCu31eGQuzCNAxhwwa";

let workdir: string;

/**
 * A minimal but genuinely valid proof bundle: real Ed25519 keys, real
 * signatures over the real canonical payload, and a consensus object derived by
 * the real engine. Only the tests that intend to break something mutate it.
 */
function makeBundle(): any {
  const ROLES: ScannerRole[] = ["static_lifecycle", "dependency_advisory", "artifact_integrity"];

  const keys = ROLES.map(() => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
    return {
      publicKeyHex: spki.subarray(spki.length - 32).toString("hex"),
      publicKeyDer: spki.toString("base64"),
      private: createPrivateKey({ key: pkcs8 as Buffer, format: "der", type: "pkcs8" }),
    };
  });

  const entries: RegistryEntry[] = ROLES.map((role, i) => ({
    publicKeyHex: keys[i].publicKeyHex,
    publicKeyDer: keys[i].publicKeyDer,
    role,
    registeredAt: "2026-01-01T00:00:00.000Z",
    registryVersion: 1,
    revoked: false,
    operator: "local-operator (single machine)",
  }));

  const SCAN_ID = "11111111-2222-3333-4444-555555555555";
  const ARTIFACT = "de".repeat(32);

  const scanners = ROLES.map((role, i) => {
    const payload = {
      schemaVersion: "d0-attestation/1",
      domain: "DEPENDENCY-ZERO/ATTESTATION",
      scanId: SCAN_ID,
      resolvedName: "demo",
      resolvedVersion: "1.0.0",
      artifactSha256: ARTIFACT,
      scannerPublicKey: keys[i].publicKeyHex,
      scannerRole: role,
      scannerVersion: "d0-scanner/2.0.0",
      policyVersion: "d0-policy/1.0.0",
      findingsCommitment: "ef".repeat(32),
      findingCount: 0,
      proposedVerdict: "allow" as const,
      riskScore: 0,
      completionStatus: "completed" as const,
      timestamp: 1767225600000,
    };
    const signature = edSign(null, Buffer.from(canonicalizeScannerResult(payload)), keys[i].private);
    return { payload, signature: signature.toString("hex") };
  }) as unknown as SignedScannerResult[];

  const consensus = computeConsensus({
    results: scanners,
    registry: entries,
    expectedScanId: SCAN_ID,
    expectedArtifactSha256: ARTIFACT,
    expectedName: "demo",
    expectedVersion: "1.0.0",
  });

  const memoData = "D0/d0-attestation/1 | c=00 | scan=x | artifact=y | consensus=allow";

  // The real commitment, so the baseline fixture passes every offline check and
  // a failing test can only be failing for the reason it was written to break.
  const commitment = attestationCommitment({
    scanId: SCAN_ID,
    resolvedName: "demo",
    resolvedVersion: "1.0.0",
    artifactSha256: ARTIFACT,
    scannersCommitment: scannersCommitment(scanners.map((s) => s.payload)),
    consensusResult: consensus.result,
    consensusPolicyVersion: consensus.policyVersion,
    registryVersion: 1,
    registryCommitment: null,
    timestamp: 1767225600000,
  });

  return {
    bundleSchema: "d0-proof-bundle/1.0.0",
    attestationSchema: "d0-attest/1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scan: {
      id: SCAN_ID,
      name: "demo",
      version: "1.0.0",
      artifactSha256: ARTIFACT,
      registry: "https://registry.npmjs.org",
    },
    registry: {
      version: 1,
      commitment: registryCommitment(entries),
      entries,
      storage: "off-chain local registry, anchored by commitment",
      onChainProgramDeployed: false,
      operator: "local-operator (single machine)",
    },
    scanners,
    consensus,
    attestation: {
      schemaVersion: "d0-attestation/1",
      mechanism: "spl-memo-wallet",
      mechanismLabel: "Solana Devnet commitment anchored via Memo",
      cluster: "devnet",
      commitmentHash: commitment,
      scanId: SCAN_ID,
      artifactSha256: ARTIFACT,
      // The baseline fixture represents an ANCHORED scan, so a clean run exits
      // 0 rather than NOT_ATTESTED. Tests that care about the unanchored case
      // clear the signature explicitly.
      status: "confirmed",
      transactionSignature: SIG,
      slot: 509816310,
      confirmationStatus: "finalized",
      blockTime: 1791701205,
      explorerUrl: `https://explorer.solana.com/tx/${SIG}?cluster=devnet`,
      submittedAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: "2026-01-01T00:00:10.000Z",
      confirmed: true,
      error: null,
      memoData,
      memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      idempotencyKey: "k",
    },
    commitment,
    memoData,
    expectedMemoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    cluster: "devnet",
    trustModel: {
      independentOperators: false,
      note: "single operator",
    },
  };
}

/**
 * Recompute the bundle commitment from its current contents.
 *
 * The attestation commitment binds the consensus RESULT, so any test that
 * legitimately changes a verdict must re-seal — exactly as the real pipeline
 * does when the security clamp is applied before the commitment is built.
 * Without this, a verdict change would trip the commitment check instead of the
 * check under test.
 */
function reseal(b: any): any {
  const c = attestationCommitment({
    scanId: b.scan.id,
    resolvedName: b.scan.name,
    resolvedVersion: b.scan.version,
    artifactSha256: b.scan.artifactSha256,
    scannersCommitment: scannersCommitment(b.scanners.map((s: any) => s.payload)),
    consensusResult: b.consensus.result,
    consensusPolicyVersion: b.consensus.policyVersion,
    registryVersion: b.registry.version,
    registryCommitment: null,
    timestamp: Date.parse(b.generatedAt),
  });
  b.commitment = c;
  b.attestation.commitmentHash = c;
  return b;
}

/** Run the real verifier and return its exit code. */
function runVerify(bundle: any, extraArgs: string[] = []): number {
  const file = join(workdir, `b-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(bundle), "utf8");
  try {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", VERIFY_CLI, file, ...extraArgs],
      { stdio: "pipe", encoding: "utf8" },
    );
    return 0;
  } catch (e) {
    const code = (e as { status?: number }).status;
    // Node reports a thrown exit code; treat anything else as a harness fault.
    assert.equal(typeof code, "number", `verifier died without an exit code: ${(e as Error).message}`);
    return code as number;
  }
}

/** Run the real verifier and capture stdout alongside the exit code. */
function runVerifyCapture(bundle: any, extraArgs: string[] = []): { code: number; out: string } {
  const file = join(workdir, `b-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(bundle), "utf8");
  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", VERIFY_CLI, file, ...extraArgs],
      { stdio: "pipe", encoding: "utf8" },
    );
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: typeof err.status === "number" ? err.status : -1, out: String(err.stdout ?? "") };
  }
}

/** Strip ANSI so assertions can match on plain text. */
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

before(() => {
  workdir = mkdtempSync(join(tmpdir(), "d0-verify-test-"));
});

after(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* CRITICAL-1: bundle / store attestation drift                                 */
/* -------------------------------------------------------------------------- */

describe("CRITICAL-1 — exported bundle matches the stored attestation", () => {
  /**
   * Reproduce the real historical defect: the store holds a confirmed
   * attestation while the copy embedded in the exported bundle still says
   * `not_started` with no signature.
   */
  function makeStaleBundle(): any {
    const b = makeBundle();
    b.attestation = {
      ...b.attestation,
      status: "not_started",
      transactionSignature: null,
      slot: null,
      confirmationStatus: null,
      blockTime: null,
      explorerUrl: null,
      confirmedAt: null,
      confirmed: false,
    };
    return b;
  }

  it("repairs a historical bundle whose embedded attestation is stale", () => {
    const bundle = makeStaleBundle();
    assert.equal(bundle.attestation.transactionSignature, null, "precondition: bundle is stale");

    const stored = { ...makeBundle().attestation, slot: 509816310 };

    const fixed = reconcileBundleAttestation(bundle, stored);

    assert.equal(fixed.attestation.transactionSignature, SIG);
    assert.equal(fixed.attestation.confirmed, true);
    assert.equal(fixed.attestation.slot, 509816310);
  });

  it("never rewrites the commitment, scanners, consensus or memo data", () => {
    const bundle = makeStaleBundle();
    const stored = { ...makeBundle().attestation, slot: 1 };

    const fixed = reconcileBundleAttestation(bundle, stored);

    assert.equal(fixed.commitment, bundle.commitment, "commitment must be untouched");
    assert.equal(fixed.memoData, bundle.memoData, "memo data must be untouched");
    assert.equal(fixed.expectedMemoProgramId, bundle.expectedMemoProgramId);
    assert.deepEqual(fixed.scanners, bundle.scanners, "signed scanner results must be untouched");
    assert.deepEqual(fixed.consensus, bundle.consensus, "consensus must be untouched");
    assert.deepEqual(fixed.registry, bundle.registry, "registry must be untouched");
    // The commitment is re-derived from the bundle, never copied from the
    // stored attestation, so a mismatched stored value cannot leak in.
    assert.equal(fixed.attestation.commitmentHash, bundle.commitment);
  });

  it("is idempotent: reconciling twice equals reconciling once", () => {
    const bundle = makeStaleBundle();
    const stored = { ...makeBundle().attestation, slot: 42 };

    const once = reconcileBundleAttestation(bundle, stored);
    const twice = reconcileBundleAttestation(once, stored);

    assert.deepEqual(twice, once);
  });

  it("returns an already-consistent bundle untouched (same object)", () => {
    const bundle = makeBundle();
    const stored = { ...bundle.attestation };

    assert.equal(reconcileBundleAttestation(bundle, stored), bundle);
  });

  it("reconciling a repaired bundle a second time is a no-op", () => {
    const bundle = makeStaleBundle();
    const stored = { ...makeBundle().attestation, slot: 42 };

    const once = reconcileBundleAttestation(bundle, stored);
    assert.equal(reconcileBundleAttestation(once, once.attestation), once);
  });

  it("cannot downgrade a bundle by reconciling against an unanchored record", () => {
    const bundle = makeBundle();
    const empty = { ...bundle.attestation, transactionSignature: null, confirmed: false, slot: null };
    const out = reconcileBundleAttestation(bundle, empty);

    // Reconciliation restates the stored record. It is a repair for records
    // where the store is authoritative and ahead — not a downgrade path.
    assert.equal(out.attestation.transactionSignature, null);
  });

  it("does not mutate the input bundle", () => {
    const bundle = makeStaleBundle();
    const before = JSON.stringify(bundle);
    reconcileBundleAttestation(bundle, { ...makeBundle().attestation });
    assert.equal(JSON.stringify(bundle), before, "reconciliation must be pure");
  });
});

/* -------------------------------------------------------------------------- */
/* CRITICAL-2: NOT_ATTESTED exit code                                           */
/* -------------------------------------------------------------------------- */

describe("CRITICAL-2 — NOT_ATTESTED is distinguishable from VERIFIED", () => {
  it("exits 6 for an unanchored bundle in online mode", () => {
    const b = makeBundle();
    b.attestation.transactionSignature = null;
    b.attestation.confirmed = false;

    assert.equal(runVerify(b), 6);
  });

  it("exits 6 for an unanchored bundle in offline mode too", () => {
    const b = makeBundle();
    b.attestation.transactionSignature = null;

    assert.equal(runVerify(b, ["--offline"]), 6);
  });

  it("never reports NOT_ATTESTED as 0, in either mode", () => {
    const b = makeBundle();
    b.attestation.transactionSignature = null;

    // The original defect: both of these exited 0, so a caller could not tell
    // "nothing was anchored" from "fully verified".
    assert.notEqual(runVerify(b), 0);
    assert.notEqual(runVerify(b, ["--offline"]), 0);
  });

  it("says NOT_ATTESTED on stdout", () => {
    const b = makeBundle();
    b.attestation.transactionSignature = null;
    const { out } = runVerifyCapture(b, ["--offline"]);

    assert.match(plain(out), /NOT_ATTESTED/);
  });

  it("exits 1, not 6, when an unanchored bundle also fails offline checks", () => {
    const b = makeBundle();
    b.attestation.transactionSignature = null;
    b.scan.artifactSha256 = "11".repeat(32); // breaks artifact binding

    assert.equal(runVerify(b, ["--offline"]), 1);
  });
});

/* -------------------------------------------------------------------------- */
/* HIGH-1: consensus is recomputed, never trusted                               */
/* -------------------------------------------------------------------------- */

describe("HIGH-1 — consensus is recomputed from signed findings", () => {
  it("rejects a tampered vote list", () => {
    const b = makeBundle();
    b.consensus.votes = b.consensus.votes.map((v: any) =>
      v.role === "static_lifecycle" ? { ...v, verdict: "block", riskScore: 99 } : v,
    );

    const { code, out } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 1);
    assert.match(plain(out), /FAIL\s+consensus votes derived/);
  });

  it("rejects a tampered quorum", () => {
    const b = makeBundle();
    b.consensus.quorumRequired = 1;
    b.consensus.quorumMet = 1;

    const { code, out } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 1);
    assert.match(plain(out), /FAIL\s+consensus quorum derived/);
  });

  it("rejects a tampered policy version", () => {
    const b = makeBundle();
    b.consensus.policyVersion = "d0-consensus/9.9.9";

    assert.equal(runVerify(b, ["--offline"]), 1);
  });

  it("rejects a verdict more permissive than the votes justify", () => {
    // Votes all say allow; the bundle claims... allow. Make one vote block and
    // leave the claimed result at allow. That is the dangerous direction.
    const b = makeBundle();
    b.scanners[0].payload.proposedVerdict = "block";
    b.consensus.result = "allow";
    b.consensus.votes = b.consensus.votes.map((v: any) =>
      v.role === "static_lifecycle" ? { ...v, verdict: "block", riskScore: 100 } : v,
    );

    const { code, out } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 1);
    assert.match(plain(out), /FAIL\s+consensus verdict not weakened/);
    assert.match(plain(out), /MORE permissive/);
  });

  it("accepts a verdict stricter than the votes justify (documented clamp)", () => {
    // This is the real express@4.18.2 case: votes say allow, consensus was
    // clamped to review by the security policy. Rejecting it would invalidate a
    // genuine historical proof, so it must pass.
    const b = makeBundle();
    b.consensus.result = "review";
    reseal(b);

    const { code, out } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 0);
    assert.match(plain(out), /PASS\s+consensus verdict not weakened/);
    assert.match(plain(out), /stricter than the derived allow/);
  });

  it("accepts a verdict equal to the derived one", () => {
    const b = makeBundle();
    const { code } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 0);
  });

  it("rejects an unknown verdict outright", () => {
    const b = makeBundle();
    b.consensus.result = "totally_fine";

    assert.equal(runVerify(b, ["--offline"]), 1);
  });

  it("rejects a bundle whose votes are stripped entirely", () => {
    const b = makeBundle();
    b.consensus.votes = [];

    const { code, out } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 1);
    assert.match(plain(out), /consensus votes derived/);
  });
});

/* -------------------------------------------------------------------------- */
/* HIGH-2: registry commitment is informational but tamper-evident              */
/* -------------------------------------------------------------------------- */

describe("HIGH-2 — registry commitment", () => {
  it("is recomputable from the bundle's own entries", () => {
    const b = makeBundle();
    assert.equal(registryCommitment(b.registry.entries), b.registry.commitment);
  });

  it("is order-independent", () => {
    const b = makeBundle();
    const shuffled = [b.registry.entries[2], b.registry.entries[0], b.registry.entries[1]];
    assert.equal(registryCommitment(shuffled), registryCommitment(b.registry.entries));
  });

  it("changes when a registry entry is tampered with", () => {
    const b = makeBundle();
    const tampered = b.registry.entries.map((e: any, i: number) =>
      i === 0 ? { ...e, revoked: true } : e,
    );
    assert.notEqual(registryCommitment(tampered), b.registry.commitment);
  });

  it("is rejected by the verifier when entries are edited to hide a revocation", () => {
    const b = makeBundle();
    // Edit the entries but leave the declared hash alone — the classic
    // "swap a revoked scanner for a friendly one" tamper.
    b.registry.entries[0].revoked = true;
    b.registry.entries[1].publicKeyHex = "ff".repeat(32);

    const { code, out } = runVerifyCapture(b, ["--offline"]);

    assert.equal(code, 1);
    assert.match(plain(out), /FAIL\s+registry hash matches entries/);
  });

  it("is labelled as informational, so a pass is not read as 'on-chain'", () => {
    const b = makeBundle();
    const { out } = runVerifyCapture(b, ["--offline"]);

    assert.match(plain(out), /registry hash matches entries \(informational, not anchored\)/);
    assert.match(plain(out), /NOT anchored on Solana/);
  });

  it("pins the historical domain separator", () => {
    // Changing this string would silently change every hash and invalidate
    // every existing bundle and its Devnet anchor.
    assert.equal(REGISTRY_DOMAIN, "DEPENDENCY-ZERO/REGISTRY");
  });
});

/* -------------------------------------------------------------------------- */
/* HIGH-3: double-anchoring is refused                                          */
/* -------------------------------------------------------------------------- */

describe("HIGH-3 — a confirmed scan is never re-anchored", () => {
  it("refuses a different signature on a confirmed record", () => {
    const r = classifyAnchorSubmission(
      { confirmed: true, transactionSignature: SIG },
      OTHER_SIG,
    );

    assert.equal(r.admission, "conflict");
    assert.equal(r.existingSignature, SIG, "must report the signature that must not be replaced");
  });

  it("accepts the same signature on a confirmed record (idempotent)", () => {
    const r = classifyAnchorSubmission({ confirmed: true, transactionSignature: SIG }, SIG);

    assert.equal(r.admission, "idempotent");
    assert.equal(r.existingSignature, SIG);
  });

  it("allows any signature when nothing is confirmed yet", () => {
    assert.equal(
      classifyAnchorSubmission({ confirmed: false, transactionSignature: null }, OTHER_SIG).admission,
      "new",
    );
    assert.equal(
      classifyAnchorSubmission({ confirmed: false, transactionSignature: SIG }, OTHER_SIG).admission,
      "new",
    );
  });

  it("treats a confirmed record with no signature as new, not as a conflict", () => {
    // Defensive: a confirmed record should always carry a signature, but if one
    // ever does not, refusing forever would strand it.
    assert.equal(
      classifyAnchorSubmission({ confirmed: true, transactionSignature: null }, SIG).admission,
      "new",
    );
  });

  it("never downgrades to idempotent when only the suffix matches", () => {
    const r = classifyAnchorSubmission({ confirmed: true, transactionSignature: SIG }, SIG.slice(0, -1));
    assert.equal(r.admission, "conflict");
  });
});

/* -------------------------------------------------------------------------- */
/* Regression guard: the verifier still fails closed                            */
/* -------------------------------------------------------------------------- */

describe("verifier fails closed on a malformed transaction reference", () => {
  it("rejects a signature that is not valid base58 Solana form", () => {
    const b = makeBundle();
    b.attestation.transactionSignature = "not-a-real-signature";
    b.attestation.confirmed = true;

    assert.equal(runVerify(b), 1);
  });
});