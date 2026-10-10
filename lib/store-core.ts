import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { DATA_DIR } from "./config.ts";
import type { FirewallEvent, ScanResolution } from "./scanner/types.ts";
import type { ProofBundle } from "./attest/bundle.ts";
import type { AttestationRecord } from "./attest/solana.ts";
import type { ConsensusResult } from "./attest/consensus.ts";
import type { ScannerNode, ScanRecord } from "./types.ts";

/**
 * File-backed persistence.
 *
 * Deliberately behind a small repository interface so a real database can be
 * swapped in without touching any UI. The store never seeds fabricated scans.
 *
 * BACKWARD COMPATIBILITY (important): records written before the real scanner
 * existed have no `phase` and no `resolution`. They are loaded as-is, are never
 * reinterpreted, and are never rewritten in place. Every new field is optional
 * on read.
 */

interface Database {
  scans: ScanRecord[];
  nodes: ScannerNode[];
  /** Firewall enforcement trail. Absent in older store files. */
  firewall?: FirewallEvent[];
  /**
   * Phase 3+4 attestation state, keyed by scan id. Deliberately SEPARATE from
   * the scan record so a Solana outage can never erase a completed security
   * scan. Absent on every pre-existing record, which is correct: those scans
   * were never attested.
   */
  attestations?: Record<string, StoredAttestation>;
}

export interface StoredAttestation {
  scanId: string;
  /** The three signed scanner results and the consensus over them. */
  bundle: ProofBundle;
  attestation: AttestationRecord;
  consensus: ConsensusResult;
  /** Independent on-chain verification, refreshed on demand. */
  verification: {
    status: string;
    checkedAt: string;
    anchoredCommitment: string | null;
    slot: number | null;
    error: string | null;
  } | null;
  updatedAt: string;
}

const EMPTY: Database = { scans: [], nodes: [], firewall: [], attestations: {} };

const filePath = isAbsolute(DATA_DIR)
  ? join(DATA_DIR, "dependency-zero.json")
  : join(process.cwd(), DATA_DIR, "dependency-zero.json");

/** Serialises writes so concurrent requests cannot clobber each other. */
let queue: Promise<unknown> = Promise.resolve();

async function readDb(): Promise<Database> {
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as Partial<Database>;
    return {
      scans: Array.isArray(parsed.scans) ? (parsed.scans as ScanRecord[]) : [],
      nodes: Array.isArray(parsed.nodes) ? (parsed.nodes as ScannerNode[]) : [],
      firewall: Array.isArray(parsed.firewall) ? (parsed.firewall as FirewallEvent[]) : [],
      attestations: parsed.attestations && typeof parsed.attestations === "object" ? parsed.attestations : {},
    };
  } catch {
    return { ...EMPTY, scans: [], nodes: [], firewall: [], attestations: {} };
  }
}

async function writeDb(db: Database): Promise<void> {
  const target = resolve(filePath);
  await mkdir(dirname(target), { recursive: true });
  // Write-then-rename keeps the file valid if the process dies mid-write.
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await rename(tmp, target);
}

async function withDb<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Read-only access; does not write the file. */
async function readOnly<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  const db = await readDb();
  return fn(db);
}

/* -------------------------------------------------------------------------- */
/* Scans                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateScanInput {
  packageName: string;
  version: string;
}

export async function createScan(input: CreateScanInput): Promise<ScanRecord> {
  return withDb((db) => {
    const now = new Date().toISOString();
    const record: ScanRecord = {
      id: randomUUID(),
      packageName: input.packageName,
      version: input.version,
      // Lifecycle is tracked in `phase`. `status` stays the field the existing
      // UI already reads, so an in-flight scan renders as PENDING exactly as
      // before rather than needing a UI redesign.
      phase: "queued",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      resolvedBy: null,
      votes: 0,
      attestationSignature: null,
      findings: [],
      error: null,
    };
    db.scans.unshift(record);
    return record;
  });
}

export async function listScans(limit = 50): Promise<ScanRecord[]> {
  return readOnly((db) =>
    [...db.scans]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit),
  );
}

export async function getScan(id: string): Promise<ScanRecord | null> {
  return readOnly((db) => db.scans.find((s) => s.id === id) ?? null);
}

export async function searchScans(query: string, limit = 20): Promise<ScanRecord[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return readOnly((db) =>
    db.scans
      .filter((s) => {
        const haystack = [
          s.packageName,
          s.version,
          s.id,
          s.attestationSignature ?? "",
          // Resolution fields, so a resolved version is searchable too.
          s.resolution?.resolvedVersion ?? "",
          s.resolution?.artifactSha256 ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, limit),
  );
}

/** Apply a verdict. Only ever called with a real scanner report. */
export async function resolveScan(
  id: string,
  update: Pick<ScanRecord, "status" | "resolvedBy" | "votes" | "findings"> &
    Partial<Pick<ScanRecord, "attestationSignature" | "error">>,
): Promise<ScanRecord | null> {
  return withDb((db) => {
    const scan = db.scans.find((s) => s.id === id);
    if (!scan) return null;
    scan.status = update.status;
    scan.resolvedBy = update.resolvedBy;
    scan.votes = update.votes;
    scan.findings = update.findings;
    if (update.attestationSignature !== undefined) {
      scan.attestationSignature = update.attestationSignature;
    }
    scan.error = update.error ?? null;
    scan.resolvedAt = new Date().toISOString();
    scan.updatedAt = scan.resolvedAt;
    return scan;
  });
}

/* -------------------------------------------------------------------------- */
/* Scanner lifecycle (new)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Persist the result of a real scan.
 *
 * `status` is set from the verdict so every existing UI surface keeps working
 * unchanged, and `phase` records the true lifecycle. `findings` is flattened to
 * the legacy shape the console already renders, while the full structured
 * findings live on `resolution`.
 */
export async function completeScan(
  id: string,
  resolution: ScanResolution,
): Promise<ScanRecord | null> {
  return withDb((db) => {
    const scan = db.scans.find((s) => s.id === id);
    if (!scan) return null;

    scan.phase = "completed";
    scan.status = resolution.verdict; // allow | review | block
    scan.verdict = resolution.verdict;
    scan.riskScore = resolution.riskScore;
    scan.scannerVersion = resolution.scannerVersion;
    scan.policyVersion = resolution.policyVersion;
    scan.resolvedBy = resolution.scannerVersion;
    scan.resolution = resolution;
    scan.findings = resolution.findings.map((f) => ({
      rule: `${f.ruleId} — ${f.title}`,
      severity: f.severity,
      detail: f.detail,
    }));
    scan.error = null;
    scan.resolvedAt = resolution.completedAt;
    scan.updatedAt = resolution.completedAt;
    return scan;
  });
}

/** Record a scan that could not be completed. Never resolves to a verdict. */
export async function failScan(id: string, code: string, message: string): Promise<ScanRecord | null> {
  return withDb((db) => {
    const scan = db.scans.find((s) => s.id === id);
    if (!scan) return null;
    scan.phase = "error";
    scan.status = "error";
    scan.verdict = null;
    scan.error = `${code}: ${message}`;
    scan.findings = [];
    scan.resolvedAt = new Date().toISOString();
    scan.updatedAt = scan.resolvedAt;
    return scan;
  });
}

/**
 * Claim a queued scan for processing.
 *
 * Conditional on `phase === "queued"`, so this is the job claim: a duplicate
 * request, a browser refresh or a second concurrent drain all get `null` back
 * and cannot run the same scan twice. Legacy records have no `phase` and are
 * never claimable.
 */
export async function markScanning(id: string): Promise<ScanRecord | null> {
  return withDb((db) => {
    const scan = db.scans.find((s) => s.id === id);
    if (!scan) return null;
    if (scan.phase !== "queued") return null;
    scan.phase = "scanning";
    scan.status = "pending";
    scan.updatedAt = new Date().toISOString();
    return scan;
  });
}

/** Records that claim to be scanning but were interrupted by a restart. */
export async function recoverStaleScans(staleMs: number): Promise<string[]> {
  return withDb((db) => {
    const cutoff = Date.now() - staleMs;
    const recovered: string[] = [];
    for (const scan of db.scans) {
      // Legacy records have no phase and are left completely untouched.
      if (scan.phase !== "scanning") continue;
      if (Date.parse(scan.updatedAt) > cutoff) continue;
      scan.phase = "queued";
      scan.status = "pending";
      scan.updatedAt = new Date().toISOString();
      recovered.push(scan.id);
    }
    return recovered;
  });
}

/** Queued scans awaiting execution, oldest first. */
export async function listQueued(limit = 10): Promise<ScanRecord[]> {
  return readOnly((db) =>
    db.scans
      .filter((s) => s.phase === "queued")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit),
  );
}

/**
 * Requeue a completed scan so it can be genuinely re-run.
 *
 * Used by the explicit "rescan" affordance for legacy records: it creates a new
 * work item rather than rewriting history on an old record.
 */
export async function enqueueRescan(id: string): Promise<ScanRecord | null> {
  return withDb((db) => {
    const source = db.scans.find((s) => s.id === id);
    if (!source) return null;
    const now = new Date().toISOString();
    const fresh: ScanRecord = {
      id: randomUUID(),
      packageName: source.packageName,
      version: source.version,
      phase: "queued",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      resolvedBy: null,
      votes: 0,
      attestationSignature: null,
      findings: [],
      error: null,
    };
    db.scans.unshift(fresh);
    return fresh;
  });
}

/* -------------------------------------------------------------------------- */
/* Scanner nodes                                                               */
/* -------------------------------------------------------------------------- */

export async function listNodes(): Promise<ScannerNode[]> {
  return readOnly((db) => db.nodes);
}

export async function registerNode(
  node: Omit<ScannerNode, "registeredAt">,
): Promise<ScannerNode> {
  return withDb((db) => {
    const record: ScannerNode = { ...node, registeredAt: new Date().toISOString() };
    db.nodes.push(record);
    return record;
  });
}

/* -------------------------------------------------------------------------- */
/* Firewall audit trail                                                        */
/* -------------------------------------------------------------------------- */

export async function appendFirewallEvent(event: FirewallEvent): Promise<void> {
  await withDb((db) => {
    db.firewall = db.firewall ?? [];
    db.firewall.unshift(event);
    // Bound the trail so the file cannot grow without limit.
    if (db.firewall.length > 500) db.firewall.length = 500;
  });
}

export async function listFirewallEvents(limit = 50): Promise<FirewallEvent[]> {
  return readOnly((db) => (db.firewall ?? []).slice(0, limit));
}

/* -------------------------------------------------------------------------- */
/* Attestations (Phase 3+4)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Persist attestation state for a scan.
 *
 * Keyed by scan id and idempotent: re-running the same attestation overwrites
 * that one entry rather than appending, so a retry cannot create a duplicate
 * chain anchor record.
 */
export async function saveAttestation(entry: StoredAttestation): Promise<void> {
  await withDb((db) => {
    db.attestations = db.attestations ?? {};
    db.attestations[entry.scanId] = { ...entry, updatedAt: new Date().toISOString() };
  });
}

export async function getAttestation(scanId: string): Promise<StoredAttestation | null> {
  return readOnly((db) => db.attestations?.[scanId] ?? null);
}

export async function listAttestations(limit = 200): Promise<StoredAttestation[]> {
  return readOnly((db) =>
    Object.values(db.attestations ?? {})
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit),
  );
}

/** Confirmed, chain-verified attestations. Used for honest network metrics. */
export async function listConfirmedAttestations(): Promise<StoredAttestation[]> {
  const all = await listAttestations(10_000);
  return all.filter((a) => a.attestation.confirmed === true);
}