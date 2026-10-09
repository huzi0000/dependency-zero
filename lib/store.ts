import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { DATA_DIR } from "@/lib/config";
import type { ScanRecord, ScannerNode } from "@/lib/types";

/**
 * File-backed persistence.
 *
 * Deliberately behind a small repository interface so a real database can be
 * swapped in without touching any UI. The store starts empty — it never seeds
 * fabricated scans, so the Dashboard shows honest empty states until real
 * scanner traffic arrives.
 */

interface Database {
  scans: ScanRecord[];
  nodes: ScannerNode[];
}

const EMPTY: Database = { scans: [], nodes: [] };

// DATA_DIR is absolute by default. join() is only used when someone points
// DZ_DATA_DIR at a relative path, in which case it resolves against the cwd.
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
      scans: Array.isArray(parsed.scans) ? parsed.scans : [],
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    };
  } catch {
    return { ...EMPTY, scans: [], nodes: [] };
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
      // No scanner node is registered yet, so the scan stays pending rather
      // than being resolved with a made-up verdict.
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
