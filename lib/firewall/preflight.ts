/**
 * Preflight: decide whether an npm install may proceed, WITHOUT executing npm.
 *
 * WHY THIS EXISTS
 *
 * `d0 guard -- npm install <pkg>` runs the real policy and then spawns npm on
 * ALLOW. That is correct for a human at a terminal, but it cannot be reused as
 * a pre-execution hook in an agent: running it would install the package as part
 * of the check, and the agent's own command would then install it a second time.
 *
 * So the scan/verify/decide/audit core is factored out here. Every enforcement
 * path in Dependency Zero — the CLI guard and the OpenCode plugin — goes through
 * this one function. There is no second verdict engine and no second copy of
 * the policy: `parseInstallCommand`, `runScan` and `decide` are the same
 * functions the CLI has always used.
 *
 * This module NEVER spawns npm. `npmExecuted` in the audit trail is therefore
 * always false for events written here; the agent's own command is what runs,
 * and only when `permit` is true.
 */

import { randomUUID } from "node:crypto";

import { runScan, type ScanDeps } from "../scanner/scan.ts";
import type { ScanResolution } from "../scanner/types.ts";
import {
  decide,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  EXIT_COMMAND_REJECTED,
  EXIT_REVIEW_HELD,
  EXIT_SCANNER_UNAVAILABLE,
  type EnforcementAction,
} from "./policy.ts";
import { CommandRejected, parseInstallCommand, type ParsedInstall } from "./parse-command.ts";
import { appendFirewallEvent } from "../store-core.ts";
import type { FirewallEvent } from "../scanner/types.ts";

/** Which enforcement path produced an event. Recorded for audit honesty. */
export type FirewallSource = "cli-guard" | "opencode-plugin";

/**
 * The five outcomes a caller must handle.
 *
 * Only `ALLOW` ever permits execution. The other four all fail closed: a caller
 * that does not understand an outcome must refuse, never default to permit.
 */
export type PreflightOutcome =
  | "ALLOW"
  | "BLOCK"
  | "REVIEW"
  | "SCANNER_UNAVAILABLE"
  | "COMMAND_REJECTED";

export interface PreflightOptions {
  /** The command to inspect, as an argument vector. */
  argv: string[];
  /** Which caller is asking. Only affects the audit record. */
  source: FirewallSource;
  /** Injected scan dependencies. Tests supply mocks; production uses the real network. */
  deps?: ScanDeps;
  /** Per-coordinate scan timeout. */
  timeoutMs?: number;
  /** Receives human-readable progress lines. */
  onProgress?: (line: string) => void;
  /** Audit sink. Injectable so tests never touch the real store. */
  audit?: (event: FirewallEvent) => Promise<void>;
}

export interface PreflightResult {
  outcome: PreflightOutcome;
  /** True only for ALLOW. Every other value must prevent execution. */
  permit: boolean;
  /** The enforcement action, for audit parity with the CLI. */
  action: EnforcementAction;
  /** The CLI exit code this outcome corresponds to. */
  exitCode: number;
  /** Why the command was held. Suitable for showing to the agent. */
  reason: string;
  /** Extra context for the agent, e.g. the offending package's findings. */
  details: string[];
  coordinates: string[];
  scanIds: string[];
  verdicts: ("allow" | "review" | "block" | "error")[];
  argv: string[];
  parsed: ParsedInstall | null;
}

const DEFAULT_SCAN_TIMEOUT_MS = 120_000;

/** Map the shared policy's exit code onto the five caller-facing outcomes. */
function outcomeFor(exitCode: number): PreflightOutcome {
  switch (exitCode) {
    case EXIT_ALLOWED:
      return "ALLOW";
    case EXIT_BLOCKED:
      return "BLOCK";
    case EXIT_REVIEW_HELD:
      return "REVIEW";
    case EXIT_SCANNER_UNAVAILABLE:
      return "SCANNER_UNAVAILABLE";
    case EXIT_COMMAND_REJECTED:
    default:
      // Unrecognised codes fail closed rather than falling through to ALLOW.
      return "COMMAND_REJECTED";
  }
}

/**
 * Inspect a command and decide, without ever starting npm.
 *
 * Ordering matters: the command is validated before anything is scanned, so a
 * malformed or out-of-scope command costs no network calls and can never be
 * "allowed" by a stale cache.
 */
export async function runPreflight(opts: PreflightOptions): Promise<PreflightResult> {
  const {
    argv,
    source,
    deps = {},
    timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
    onProgress,
    audit = appendFirewallEvent,
  } = opts;

  const say = (line: string) => onProgress?.(line);

  /* ---- 1. Parse. A rejected command never reaches the scanner. ---------- */
  let parsed: ParsedInstall;
  try {
    parsed = parseInstallCommand(argv);
  } catch (err) {
    if (err instanceof CommandRejected) {
      const reason = `${err.code}: ${err.message}`;
      await writeAudit(audit, {
        source,
        command: argv,
        coordinates: [],
        scanIds: [],
        verdicts: [],
        action: "BLOCKED_BEFORE_EXECUTION",
        reason,
        exitCode: EXIT_COMMAND_REJECTED,
      });
      return {
        outcome: "COMMAND_REJECTED",
        permit: false,
        action: "BLOCKED_BEFORE_EXECUTION",
        exitCode: EXIT_COMMAND_REJECTED,
        reason: err.message,
        details: [],
        coordinates: [],
        scanIds: [],
        verdicts: [],
        argv,
        parsed: null,
      };
    }
    throw err;
  }

  say(`scanning ${parsed.coordinates.join(", ")}`);

  /* ---- 2. Scan every coordinate. --------------------------------------- */
  const results = new Map<string, ScanResolution | null>();
  const scanIds: string[] = [];
  const verdicts: ("allow" | "review" | "block" | "error")[] = [];
  const details: string[] = [];

  for (const coord of parsed.coordinates) {
    let outcome;
    try {
      let timer: NodeJS.Timeout | undefined;
      outcome = await Promise.race([
        runScan(coord, deps),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("scan timed out")), timeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    } catch (e) {
      // A thrown scan is a failed scan. It is never treated as "clean".
      outcome = {
        ok: false as const,
        error: { code: "DZ_CLI_TIMEOUT", message: (e as Error).message },
      };
    }

    if (outcome.ok && outcome.resolution) {
      const r = outcome.resolution;
      scanIds.push(`${r.resolvedName}@${r.resolvedVersion}/${r.artifactSha256.slice(0, 12)}`);
      results.set(coord, r);
      verdicts.push(r.verdict);
      say(
        `${r.verdict.toUpperCase()}  ${r.resolvedName}@${r.resolvedVersion}  ` +
          `sha256 ${r.artifactSha256.slice(0, 32)}…  ${r.findings.length} finding(s)  score ${r.riskScore}/100`,
      );

      for (const f of r.findings
        .filter((f) => f.severity === "critical" || f.severity === "high")
        .slice(0, 5)) {
        details.push(`${r.resolvedName}@${r.resolvedVersion}: ${f.ruleId} — ${f.title}`);
      }
    } else {
      results.set(coord, null);
      verdicts.push("error");
      const code = outcome.error?.code ?? "";
      details.push(`${coord}: scanner did not complete (${code})`);
      say(`ERROR  ${coord}  ${code}`);
    }
  }

  /* ---- 3. Decide with the shared policy. ------------------------------- */
  const decision = decide(results, parsed.coordinates);
  const outcome = outcomeFor(decision.exitCode);

  if (source === "opencode-plugin" && !decision.permit) {
    // The plugin never starts npm; the agent's own command is what would run.
    say("npm was NOT started.");
  }

  await writeAudit(audit, {
    source,
    command: parsed.argv,
    coordinates: parsed.coordinates,
    scanIds,
    verdicts,
    action: decision.action,
    reason: decision.reason,
    exitCode: decision.exitCode,
  });

  return {
    outcome,
    // `decide` is the single source of truth. permit is re-derived rather than
    // assumed, so a policy change that ever produced a non-permitting ALLOW
    // could not silently open the gate.
    permit: decision.permit && outcome === "ALLOW",
    action: decision.action,
    exitCode: decision.exitCode,
    reason: decision.reason,
    details,
    coordinates: parsed.coordinates,
    scanIds,
    verdicts,
    argv: parsed.argv,
    parsed,
  };
}

/**
 * Write an audit event.
 *
 * An audit failure must never change the enforcement decision — refusing to
 * scan because the log file is locked would be a denial of service. It is also
 * never silently swallowed: the caller reports it.
 */
async function writeAudit(
  audit: (event: FirewallEvent) => Promise<void>,
  fields: Omit<FirewallEvent, "id" | "timestamp" | "npmExecuted" | "command"> & {
    command: string[];
    source: FirewallSource;
  },
): Promise<string | null> {
  try {
    await audit({
      ...fields,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      // This module never spawns npm, whatever the decision was.
      npmExecuted: false,
    });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}