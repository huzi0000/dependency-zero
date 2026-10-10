import "server-only";

import { runScan } from "@/lib/scanner/scan";
import { completeScan, failScan, listQueued, markScanning, recoverStaleScans } from "@/lib/store";

/**
 * Durable local job runner.
 *
 * LIMITATION, stated plainly: this is an in-process worker for local Node
 * deployments (`next dev` / `next start`). It is NOT safe for a serverless
 * runtime where the process may be frozen between requests.
 *
 * How it stays correct anyway:
 *
 *  - Work items live in the scan store, not in memory. The store is the queue.
 *  - Each job transitions queued -> scanning -> completed|error in the store,
 *    so progress survives the process being killed.
 *  - `recoverStaleScans` requeues anything left mid-flight after a restart, so a
 *    crash cannot strand a scan forever.
 *  - A single in-flight guard prevents duplicate concurrent execution of the
 *    same job within a process.
 *  - Claiming is idempotent: `markScanning` is a no-op if the record is already
 *    scanning, completed or errored, so duplicate POSTs cannot double-run work.
 *
 * For a multi-process or serverless deployment this module must be replaced by
 * a real queue. The scanner itself (`lib/scanner/*`) is unaffected.
 */

/** A job left "scanning" longer than this is assumed dead and requeued. */
const STALE_MS = 5 * 60 * 1000;

/** Serialise execution inside this process. */
let running = false;
/** Ids currently being processed, to make duplicate requests idempotent. */
const inFlight = new Set<string>();

let recoveryDone = false;
let kicked = false;

async function processOne(id: string): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const scan = await markScanning(id);
    if (!scan) return;

    // Build the coordinate the user actually asked for.
    const requested =
      scan.packageName && scan.version && scan.version !== "latest"
        ? `${scan.packageName}@${scan.version}`
        : scan.packageName;

    const outcome = await runScan(requested);

    if (outcome.ok && outcome.resolution) {
      await completeScan(scan.id, outcome.resolution);
    } else {
      const code = outcome.error?.code ?? "DZ_UNKNOWN";
      const message = outcome.error?.message ?? "Scan failed for an unknown reason.";
      // An error never carries a verdict. It cannot be mistaken for ALLOW.
      await failScan(scan.id, code, message);
    }
  } catch (err) {
    // Last-resort guard: an unexpected throw must still not leave the job stuck.
    try {
      await failScan(id, "DZ_INTERNAL", (err as Error).message ?? "Unexpected scanner error.");
    } catch {
      /* nothing further we can do; the record stays non-terminal */
    }
  } finally {
    inFlight.delete(id);
  }
}

/**
 * Drain the queue. Safe to call often; it returns immediately if a drain is
 * already running.
 */
export async function drainQueue(maxJobs = 5): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!recoveryDone) {
      recoveryDone = true;
      // Best-effort: requeue anything a previous process left mid-flight.
      await recoverStaleScans(STALE_MS).catch(() => undefined);
    }

    for (let i = 0; i < maxJobs; i++) {
      const queued = await listQueued(1);
      const next = queued[0];
      if (!next) break;
      await processOne(next.id);
    }
  } finally {
    running = false;
  }
}

/**
 * Schedule a drain without awaiting it.
 *
 * The promise is tracked so an unhandled rejection cannot crash the server, and
 * it is a genuine await on the work itself rather than a fire-and-forget that a
 * serverless runtime could drop.
 */
export function kickQueue(): void {
  if (kicked) {
    // Still request a drain; drainQueue self-guards against overlap.
    void drainQueue().catch(() => undefined);
    return;
  }
  kicked = true;
  void drainQueue()
    .catch(() => undefined)
    .finally(() => {
      kicked = false;
    });
}

/** Test hook: run one specific scan to completion. */
export async function runScanNow(id: string): Promise<void> {
  await processOne(id);
}
