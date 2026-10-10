import { spawn } from "node:child_process";

import { runScan } from "../lib/scanner/scan.ts";
import type { ScanResolution } from "../lib/scanner/types.ts";
import { decide, EXIT_COMMAND_REJECTED } from "../lib/firewall/policy.ts";
import { npmInvocation } from "../lib/firewall/parse-command.ts";
import { CommandRejected, parseInstallCommand } from "../lib/firewall/parse-command.ts";
import { appendFirewallEvent } from "../lib/store-core.ts";
import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------------------ */
/* Output helpers                                                             */
/* ------------------------------------------------------------------------ */

const isTTY = process.stdout.isTTY === true;
const c = {
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}
function errOut(s: string): void {
  process.stderr.write(`${s}\n`);
}

/* ------------------------------------------------------------------------ */
/* Audit                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Append an enforcement event to the D0 store, so the audit trail is visible in
 * the console.
 *
 * Only sanitised fields are recorded: the argv array, coordinates, scan refs,
 * verdicts and the action. No environment values, no terminal history, no raw
 * shell string, no credentials.
 */
async function audit(event: {
  argv: string[];
  coordinates: string[];
  scanIds: string[];
  verdicts: ("allow" | "review" | "block" | "error")[];
  action: "ALLOWED_INSTALL" | "BLOCKED_BEFORE_EXECUTION" | "REVIEW_HELD";
  reason: string;
  npmExecuted: boolean;
  exitCode: number | null;
}): Promise<void> {
  try {
    await appendFirewallEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      command: event.argv,
      coordinates: event.coordinates,
      scanIds: event.scanIds,
      verdicts: event.verdicts,
      action: event.action,
      reason: event.reason,
      npmExecuted: event.npmExecuted,
      exitCode: event.exitCode,
    });
  } catch (e) {
    // An audit write failure must not change the enforcement decision, but it
    // is surfaced rather than swallowed.
    errOut(c.yellow(`  warning: could not write audit event: ${(e as Error).message}`));
  }
}

/* ------------------------------------------------------------------------ */
/* Guard                                                                      */
/* ------------------------------------------------------------------------ */

const SCAN_TIMEOUT_MS = 120_000;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] !== "guard") {
    errOut(c.bold("d0 — Dependency Zero install firewall"));
    errOut("");
    errOut("Usage:");
    errOut("  d0 guard -- npm install <package>[@version] ...");
    errOut("");
    errOut("Only npm install is guarded. Everything else is rejected.");
    return EXIT_COMMAND_REJECTED;
  }

  // Everything after the `--` separator is the command to guard.
  const sep = argv.indexOf("--");
  if (sep === -1 || sep === argv.length - 1) {
    errOut(c.red("Rejected: no command to guard."));
    errOut("Usage: d0 guard -- npm install <package>");
    return EXIT_COMMAND_REJECTED;
  }

  const commandArgv = argv.slice(sep + 1);

  let parsed;
  try {
    parsed = parseInstallCommand(commandArgv);
  } catch (err) {
    if (err instanceof CommandRejected) {
      errOut(c.red(err.message));
      await audit({
        argv: commandArgv,
        coordinates: [],
        scanIds: [],
        verdicts: [],
        action: "BLOCKED_BEFORE_EXECUTION",
        reason: `${err.code}: ${err.message}`,
        npmExecuted: false,
        exitCode: EXIT_COMMAND_REJECTED,
      });
      return EXIT_COMMAND_REJECTED;
    }
    throw err;
  }

  out(c.bold("Dependency Zero — pre-install security check"));
  out(c.dim(`  command   : npm ${parsed.args.join(" ")}`));
  out(c.dim(`  packages  : ${parsed.coordinates.join(", ")}`));
  out("");

  /* ---- Scan every coordinate ------------------------------------------ */
  const results = new Map<string, ScanResolution | null>();
  const scanIds: string[] = [];
  const verdicts: ("allow" | "review" | "block" | "error")[] = [];

  for (const coord of parsed.coordinates) {
    out(`  ${c.dim("scanning")} ${coord} …`);
    const started = Date.now();

    let outcome;
    try {
      let timer: NodeJS.Timeout | undefined;
      outcome = await Promise.race([
        runScan(coord),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("scan timed out")), SCAN_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    } catch (e) {
      outcome = {
        ok: false as const,
        error: { code: "DZ_CLI_TIMEOUT", message: (e as Error).message },
      };
    }
    const ms = Date.now() - started;

    if (outcome.ok && outcome.resolution) {
      const r = outcome.resolution;
      // Stable, human-checkable reference. The console record is the canonical
      // id; this pairs the name, resolved version and artifact hash so the two
      // scans of the same artifact are distinguishable and verifiable.
      const scanRef = `${r.resolvedName}@${r.resolvedVersion}/${r.artifactSha256.slice(0, 12)}`;
      scanIds.push(scanRef);
      results.set(coord, r);
      verdicts.push(r.verdict);
      const badge =
        r.verdict === "allow" ? c.green("ALLOW") : r.verdict === "block" ? c.red("BLOCK") : c.yellow("REVIEW");
      out(`           ${badge}  ${r.resolvedName}@${r.resolvedVersion}  ${c.dim(`score ${r.riskScore}/100`)}`);
      out(
        c.dim(
          `           sha256 ${r.artifactSha256.slice(0, 32)}…  ${ms}ms  ${r.findings.length} finding(s)`,
        ),
      );
      for (const f of r.findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 3)) {
        out(c.dim(`           - ${f.ruleId} ${f.title}`));
        const ev = f.evidence[0];
        if (ev) out(c.dim(`             ${ev.file}${ev.line ? `:${ev.line}` : ""}`));
      }
    } else {
      results.set(coord, null);
      verdicts.push("error");
      out(`           ${c.red("ERROR")}  ${coord}  ${c.dim(outcome.error?.code ?? "")} ${outcome.error?.message ?? ""}`);
    }
  }

  out("");

  /* ---- Enforce --------------------------------------------------------- */
  const decision = decide(results, parsed.coordinates);

  if (decision.action === "ALLOWED_INSTALL") {
    out(c.green(`  ALLOW — ${decision.reason}`));
  } else if (decision.action === "REVIEW_HELD") {
    out(c.yellow(`  HELD — ${decision.reason}`));
  } else {
    out(c.red(`  BLOCK — ${decision.reason}`));
  }

  if (!decision.permit) {
    out(c.dim("  npm was NOT started."));
    await audit({
      argv: parsed.argv,
      coordinates: parsed.coordinates,
      scanIds,
      verdicts,
      action: decision.action,
      reason: decision.reason,
      npmExecuted: false,
      exitCode: decision.exitCode,
    });
    return decision.exitCode;
  }

  /* ---- Execute with an argv array, never a shell ---------------------- */
  out("");
  out(c.dim("  spawning npm with an argument array (no shell)…"));

  // Invoke npm's JS entry point via node so no shell is ever involved.
  const npm = npmInvocation();
  const child = spawn(npm.program, [...npm.prefixArgs, ...parsed.args], {
    stdio: "inherit",
    shell: false, // Explicit and load-bearing.
    windowsHide: true,
  });

  const code = await new Promise<number>((resolve) => {
    child.on("error", (e) => {
      errOut(c.red(`  failed to start npm: ${e.message}`));
      resolve(-1);
    });
    child.on("close", (exitCode) => resolve(exitCode ?? -1));
  });

  await audit({
    argv: parsed.argv,
    coordinates: parsed.coordinates,
    scanIds,
    verdicts,
    action: decision.action,
    reason: decision.reason,
    npmExecuted: true,
    exitCode: code,
  });

  out("");
  out(c.dim(`  npm exited with code ${code}.`));
  return code;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    errOut(c.red(`d0 internal error: ${(e as Error).message}`));
    process.exitCode = 1;
  });
