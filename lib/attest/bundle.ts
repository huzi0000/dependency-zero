import {
  attestationCommitment,
  canonicalizeScannerResult,
  memoPayload,
  scannersCommitment,
  SCHEMA_VERSION,
} from "./canonical.ts";
import type { ScannerResultPayload } from "./canonical.ts";
import type { ConsensusResult, RegistryEntry, SignedScannerResult } from "./consensus.ts";
import { attestationCommitment as computeCommitment } from "./canonical.ts";
import type { AttestationRecord } from "./solana.ts";
import { verifySignature } from "./verify-signature.ts";

/**
 * Exportable proof bundle.
 *
 * This is the artefact an independent party needs to re-check a scan WITHOUT
 * trusting this application. It is deliberately self-contained: everything
 * required to recompute the commitment and verify every signature is included.
 *
 * WHAT IS NEVER IN HERE:
 *   - any private key or secret
 *   - environment variables
 *   - the user's wallet
 *   - npm registry credentials
 *   - raw package source
 *
 * Everything here is either a public key, a public signature, or a public hash.
 */

export const BUNDLE_SCHEMA = "d0-proof-bundle/1.0.0";

export interface ProofBundle {
  /** Version of this bundle format. */
  bundleSchema: string;
  /** Attestation schema version, mirrored so a verifier can cross-check. */
  attestationSchema: string;
  generatedAt: string;
  scan: {
    id: string;
    name: string;
    version: string;
    artifactSha256: string;
    registry: string;
  };
  registry: {
    version: number;
    commitment: string;
    entries: RegistryEntry[];
    /** Honest about what this registry is and is not. */
    storage: "off-chain local registry, anchored by commitment";
    onChainProgramDeployed: false;
    operator: string;
  };
  scanners: SignedScannerResult[];
  consensus: ConsensusResult;
  attestation: AttestationRecord;
  /** The single hash anchored to Solana. */
  commitment: string;
  /** Verbatim Memo text, so the on-chain anchor can be compared byte for byte. */
  memoData: string;
  expectedMemoProgramId: string;
  cluster: string;
  /** Documents the trust assumptions a verifier is accepting. */
  trustModel: {
    independentOperators: false;
    note: string;
  };
}

/** Build a bundle from a completed, signed scan. */
export function buildProofBundle(params: {
  scanId: string;
  name: string;
  version: string;
  artifactSha256: string;
  registry: string;
  registryEntries: RegistryEntry[];
  registryCommitment: string;
  registryVersion: number;
  operator: string;
  scanners: SignedScannerResult[];
  consensus: ConsensusResult;
  attestation: AttestationRecord;
  timestamp: number;
}): ProofBundle {
  const commitment = attestationCommitment({
    scanId: params.scanId,
    resolvedName: params.name,
    resolvedVersion: params.version,
    artifactSha256: params.artifactSha256,
    scannersCommitment: scannersCommitment(params.scanners.map((s) => s.payload)),
    consensusResult: params.consensus.result,
    consensusPolicyVersion: params.consensus.policyVersion,
    registryVersion: params.registryVersion,
    registryCommitment: null,
    timestamp: params.timestamp,
  });

  const memo = memoPayload({
    commitment,
    scanId: params.scanId,
    artifactSha256: params.artifactSha256,
    consensus: params.consensus.result,
  });

  return {
    bundleSchema: BUNDLE_SCHEMA,
    attestationSchema: SCHEMA_VERSION,
    generatedAt: new Date(params.timestamp).toISOString(),
    scan: {
      id: params.scanId,
      name: params.name,
      version: params.version,
      artifactSha256: params.artifactSha256,
      registry: params.registry,
    },
    registry: {
      version: params.registryVersion,
      commitment: params.registryCommitment,
      entries: params.registryEntries,
      storage: "off-chain local registry, anchored by commitment",
      onChainProgramDeployed: false,
      operator: params.operator,
    },
    scanners: params.scanners,
    consensus: params.consensus,
    attestation: params.attestation,
    commitment,
    memoData: memo,
    expectedMemoProgramId: params.attestation.memoProgramId,
    cluster: params.attestation.cluster,
    trustModel: {
      independentOperators: false,
      note:
        "All scanner keys in this bundle are controlled by a single operator on a single host. " +
        "Signatures prove internal consistency and tamper-evidence, not independent third-party " +
        "verification or Byzantine fault tolerance.",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Offline verification of a bundle (no network)                                */
/* -------------------------------------------------------------------------- */

export interface OfflineCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Verify everything that can be checked without the network:
 * signature validity, identity/registry status, artifact binding, the findings
 * commitment, and the overall attestation commitment.
 *
 * A bundle can pass this and still fail on-chain verification; the two are
 * reported separately so neither is mistaken for the other.
 */
export function verifyBundleOffline(bundle: ProofBundle): {
  checks: OfflineCheck[];
  ok: boolean;
  recomputedCommitment: string;
} {
  const checks: OfflineCheck[] = [];
  const byKey = new Map(bundle.registry.entries.map((e) => [e.publicKeyHex, e]));

  let allSignatures = true;
  for (const s of bundle.scanners) {
    const entry = byKey.get(s.payload.scannerPublicKey);
    if (!entry) {
      allSignatures = false;
      checks.push({
        name: `signature ${s.payload.scannerRole}`,
        ok: false,
        detail: "signer is not present in the bundle registry",
      });
      continue;
    }
    if (entry.revoked) {
      allSignatures = false;
      checks.push({ name: `signature ${s.payload.scannerRole}`, ok: false, detail: "identity is revoked" });
      continue;
    }
    const good = verifySignature(canonicalizeScannerResult(s.payload), s.signature, entry.publicKeyDer);
    if (!good) allSignatures = false;
    checks.push({
      name: `signature ${s.payload.scannerRole}`,
      ok: good,
      detail: good ? "Ed25519 signature verified" : "Ed25519 signature did NOT verify",
    });
  }

  // Artifact binding: every scanner must be about the same artifact.
  const boundToArtifact = bundle.scanners.every(
    (s) => s.payload.artifactSha256 === bundle.scan.artifactSha256,
  );
  checks.push({
    name: "artifact binding",
    ok: boundToArtifact,
    detail: boundToArtifact
      ? "every signed result is bound to the bundle artifact hash"
      : "a signed result refers to a different artifact hash",
  });

  const boundToScan = bundle.scanners.every((s) => s.payload.scanId === bundle.scan.id);
  checks.push({
    name: "scan binding",
    ok: boundToScan,
    detail: boundToScan ? "every signed result is bound to this scan id" : "a signed result refers to another scan",
  });

  // Recompute the commitment from the bundle's own contents.
  const scannersCommitmentValue = scannersCommitment(bundle.scanners.map((s) => s.payload));
  const ts = Date.parse(bundle.generatedAt);
  const recomputed = computeCommitment({
    scanId: bundle.scan.id,
    resolvedName: bundle.scan.name,
    resolvedVersion: bundle.scan.version,
    artifactSha256: bundle.scan.artifactSha256,
    scannersCommitment: scannersCommitmentValue,
    consensusResult: bundle.consensus.result,
    consensusPolicyVersion: bundle.consensus.policyVersion,
    registryVersion: bundle.registry.version,
    registryCommitment: null,
    timestamp: Number.isFinite(ts) ? ts : 0,
  });

  const commitmentOk = recomputed === bundle.commitment;
  checks.push({
    name: "attestation commitment",
    ok: commitmentOk,
    detail: commitmentOk
      ? `recomputed ${recomputed.slice(0, 16)}… matches the bundle`
      : `recomputed ${recomputed.slice(0, 16)}… does NOT match bundle ${bundle.commitment.slice(0, 16)}…`,
  });

  return { checks, ok: checks.every((c) => c.ok), recomputedCommitment: recomputed };
}
