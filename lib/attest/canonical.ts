import { createHash } from "node:crypto";

/**
 * Canonical serialisation for signed payloads and commitments.
 *
 * Why this exists: a signature is only meaningful over bytes that cannot be
 * re-interpreted. JSON is not canonical (key order, unicode escaping, number
 * formatting are all implementation-defined), so signing JSON would let two
 * different byte strings decode to the "same" object and break replay
 * protection.
 *
 * The encoding below is deterministic by construction:
 *   - fixed field order, chosen once and never derived from input order
 *   - every string is length-prefixed, so "ab"+"c" can never collide with "a"+"bc"
 *   - integers are emitted as fixed-width lowercase hex, so no locale or float
 *     formatting can change the bytes
 *   - optional fields are always emitted, using an explicit null sentinel
 *
 * Any change to the field order or encoding is a protocol change and MUST bump
 * SCHEMA_VERSION, because previously-signed payloads would stop verifying.
 */

/** Bump on any encoding change. Part of every signed payload. */
export const SCHEMA_VERSION = "d0-attestation/1";

/**
 * Domain separator. Prevents a signature made for this protocol from ever being
 * replayed into another protocol that happens to verify Ed25519 signatures over
 * similar-looking bytes.
 */
export const DOMAIN = "DEPENDENCY-ZERO/ATTESTATION";

/** Domain separator for scanner role findings, distinct from attestations. */
export const SCANNER_DOMAIN = "DEPENDENCY-ZERO/SCANNER-RESULT";

/** Fixed-width encoding of an integer, so bytes never vary with formatting. */
function u64(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`canonical: expected a non-negative safe integer, got ${value}`);
  }
  return value.toString(16).padStart(16, "0");
}

/**
 * Length-prefix a string. The byte length is encoded first so a concatenation of
 * two strings can never be re-split into a different pair.
 */
function str(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  return `${u64(bytes.length)}:${bytes.toString("utf8")}`;
}

function strList(values: readonly string[]): string {
  return `${u64(values.length)}[${values.map(str).join("")}]`;
}

function bool(value: boolean): string {
  return value ? "1" : "0";
}

function optStr(value: string | null): string {
  return value === null ? "-" : str(value);
}

/** Hash of arbitrary bytes, hex. Used for commitments. */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Scanner result payload                                                      */
/* -------------------------------------------------------------------------- */

export type ScannerRole = "static_lifecycle" | "dependency_advisory" | "artifact_integrity";

export const SCANNER_ROLES: ScannerRole[] = [
  "static_lifecycle",
  "dependency_advisory",
  "artifact_integrity",
];

export type CompletionStatus = "completed" | "failed";

/**
 * The exact bytes a scanner signs.
 *
 * Every field that gives the signature meaning is bound: which scan, which
 * artifact, which identity, which role, which policy, what it found, and what
 * it concluded. Changing any of them invalidates the signature.
 */
export interface ScannerResultPayload {
  schemaVersion: string;
  domain: string;
  scanId: string;
  resolvedName: string;
  resolvedVersion: string;
  artifactSha256: string;
  scannerPublicKey: string;
  scannerRole: ScannerRole;
  scannerVersion: string;
  policyVersion: string;
  /** Hash over the scanner's own canonical finding list. */
  findingsCommitment: string;
  findingCount: number;
  proposedVerdict: "allow" | "review" | "block";
  riskScore: number;
  completionStatus: CompletionStatus;
  /** Epoch milliseconds. */
  timestamp: number;
}

/**
 * Canonical encoding of a scanner result.
 *
 * Field order here IS the protocol. Do not reorder without bumping
 * SCHEMA_VERSION.
 */
export function canonicalizeScannerResult(p: ScannerResultPayload): Buffer {
  const parts = [
    `v1:${DOMAIN}:SCANNER`,
    `schema=${str(p.schemaVersion)}`,
    `scan=${str(p.scanId)}`,
    `pkg=${str(p.resolvedName)}`,
    `ver=${str(p.resolvedVersion)}`,
    `artifact=${str(p.artifactSha256)}`,
    `pubkey=${str(p.scannerPublicKey)}`,
    `role=${str(p.scannerRole)}`,
    `sver=${str(p.scannerVersion)}`,
    `pver=${str(p.policyVersion)}`,
    `findings=${str(p.findingsCommitment)}`,
    `fcount=${u64(p.findingCount)}`,
    `verdict=${str(p.proposedVerdict)}`,
    `risk=${u64(p.riskScore)}`,
    `status=${str(p.completionStatus)}`,
    `ts=${u64(p.timestamp)}`,
  ];
  return Buffer.from(parts.join("\n"), "utf8");
}

/* -------------------------------------------------------------------------- */
/* Findings commitment                                                        */
/* -------------------------------------------------------------------------- */

export interface CanonicalFinding {
  ruleId: string;
  severity: string;
  confidence: string;
  kind: string;
  title: string;
  evidenceFile: string;
  evidenceLine: number | null;
  evidenceSnippet: string;
}

/**
 * Commitment over a scanner's findings.
 *
 * Binds the evidence itself, not just a count, so a signed result cannot be
 * paired with a different finding list.
 */
export function canonicalizeFindings(findings: readonly CanonicalFinding[]): Buffer {
  const sorted = [...findings].sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    if (a.evidenceFile !== b.evidenceFile) return a.evidenceFile < b.evidenceFile ? -1 : 1;
    const la = a.evidenceLine ?? -1;
    const lb = b.evidenceLine ?? -1;
    if (la !== lb) return la - lb;
    return a.evidenceSnippet < b.evidenceSnippet ? -1 : 1;
  });

  const parts = [`v1:${DOMAIN}:FINDINGS`, `n=${u64(sorted.length)}`];
  for (const f of sorted) {
    parts.push(
      [
        `f:${str(f.ruleId)}`,
        str(f.severity),
        str(f.confidence),
        str(f.kind),
        str(f.title),
        str(f.evidenceFile),
        f.evidenceLine === null ? "-" : u64(f.evidenceLine),
        str(f.evidenceSnippet),
      ].join("|"),
    );
  }
  return Buffer.from(parts.join("\n"), "utf8");
}

export function findingsCommitment(findings: readonly CanonicalFinding[]): string {
  return sha256Hex(canonicalizeFindings(findings));
}

/* -------------------------------------------------------------------------- */
/* Attestation commitment (what gets anchored on Solana)                       */
/* -------------------------------------------------------------------------- */

export interface AttestationCommitmentInput {
  scanId: string;
  resolvedName: string;
  resolvedVersion: string;
  artifactSha256: string;
  /** Combined commitment over every verified scanner result. */
  scannersCommitment: string;
  consensusResult: string;
  consensusPolicyVersion: string;
  registryVersion: number;
  /** Registry commitment if one was anchored; null when purely local. */
  registryCommitment: string | null;
  timestamp: number;
}

/**
 * The single hash anchored to Solana.
 *
 * It commits to the artifact, the scanners' signed findings, the consensus
 * outcome and the registry version together, so altering any one of them
 * changes this hash and invalidates the on-chain anchor.
 */
export function attestationCommitment(input: AttestationCommitmentInput): string {
  const parts = [
    `v1:${DOMAIN}:ATTEST`,
    `schema=${str(SCHEMA_VERSION)}`,
    `scan=${str(input.scanId)}`,
    `pkg=${str(input.resolvedName)}`,
    `ver=${str(input.resolvedVersion)}`,
    `artifact=${str(input.artifactSha256)}`,
    `scanners=${str(input.scannersCommitment)}`,
    `consensus=${str(input.consensusResult)}`,
    `cpol=${str(input.consensusPolicyVersion)}`,
    `regver=${u64(input.registryVersion)}`,
    `regcommit=${optStr(input.registryCommitment)}`,
    `ts=${u64(input.timestamp)}`,
  ];
  return sha256Hex(Buffer.from(parts.join("\n"), "utf8"));
}

/**
 * Combined commitment over every scanner's signed payload.
 *
 * Sorts by public key so the value is independent of assessment ordering.
 */
export function scannersCommitment(payloads: readonly ScannerResultPayload[]): string {
  const sorted = [...payloads].sort((a, b) =>
    a.scannerPublicKey < b.scannerPublicKey ? -1 : a.scannerPublicKey > b.scannerPublicKey ? 1 : 0,
  );
  const parts = [`v1:${DOMAIN}:SCANNERS`, `n=${u64(sorted.length)}`];
  for (const p of sorted) {
    parts.push(sha256Hex(canonicalizeScannerResult(p)));
  }
  return sha256Hex(Buffer.from(parts.join("\n"), "utf8"));
}

/* -------------------------------------------------------------------------- */
/* Memo payload (bounded, human-inspectable on the Explorer)                   */
/* -------------------------------------------------------------------------- */

/**
 * Serialise the commitment into a Memo string.
 *
 * Memo data is public and permanent, so this carries ONLY the commitment and
 * the identifiers needed to look the proof up. No package internals, no
 * addresses of private keys, nothing sensitive.
 */
export function memoPayload(input: {
  commitment: string;
  scanId: string;
  artifactSha256: string;
  consensus: string;
}): string {
  return [
    `D0/${SCHEMA_VERSION}`,
    `c=${input.commitment}`,
    `scan=${input.scanId}`,
    `artifact=${input.artifactSha256}`,
    `consensus=${input.consensus}`,
  ].join(" | ");
}

/* -------------------------------------------------------------------------- */
/* Registry commitment                                                          */
/* -------------------------------------------------------------------------- */

/** The fields a registry commitment binds. Mirrors consensus.RegistryEntry. */
export interface RegistryCommitmentEntry {
  publicKeyHex: string;
  role: string;
  registryVersion: number;
  revoked: boolean;
  operator: string;
}

/**
 * Domain separator for the registry commitment.
 *
 * Pinned as a literal and deliberately NOT derived from DOMAIN. The earlier
 * implementation used the string `DEPENDENCY-ZERO/REGISTRY`; reusing the shared
 * ATTESTATION domain here would silently change every hash and invalidate all
 * existing bundles and their on-chain anchors. Historical output must be
 * byte-identical, so this constant is frozen.
 */
export const REGISTRY_DOMAIN = "DEPENDENCY-ZERO/REGISTRY";

/**
 * Hash over a scanner registry, for detecting changes to the trusted key set.
 *
 * STATUS — read this before relying on it:
 *
 *   This value is INFORMATIONAL. It is NOT bound into the attestation
 *   commitment (every call site passes `registryCommitment: null`) and it does
 *   NOT appear in the Memo payload, so it is not anchored on Solana and is not
 *   covered by any signature.
 *
 *   It IS recomputable from a bundle's own `registry.entries`, so a verifier can
 *   use it as a tamper check on the declared registry: if an attacker edits the
 *   entries without updating the hash, the recomputation disagrees and the
 *   bundle is rejected. That is the honest guarantee — "the declared registry
 *   matches the entries shipped alongside it", not "the registry is anchored".
 *
 *   Output is byte-identical to the original implementation, so existing
 *   bundles and their Devnet anchors remain valid.
 *
 *   The function lives in this module, which imports no store and no SDK, so
 *   the standalone verifier can check it without any Dependency Zero service.
 */
export function registryCommitment(registry: readonly RegistryCommitmentEntry[]): string {
  const sorted = [...registry].sort((a, b) =>
    a.publicKeyHex < b.publicKeyHex ? -1 : a.publicKeyHex > b.publicKeyHex ? 1 : 0,
  );
  const h = createHash("sha256");
  h.update(`v1:${REGISTRY_DOMAIN}\nn=${sorted.length}\n`);
  for (const e of sorted) {
    h.update(`${e.publicKeyHex}|${e.role}|${e.registryVersion}|${e.revoked}|${e.operator}\n`);
  }
  return h.digest("hex");
}