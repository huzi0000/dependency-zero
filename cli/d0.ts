import { spawn } from "node:child_process";

import type { EnforcementAction } from "../lib/firewall/policy.ts";
import { EXIT_ALLOWED, EXIT_COMMAND_REJECTED } from "../lib/firewall/policy.ts";
import { npmInvocation } from "../lib/firewall/parse-command.ts";
import { runPreflight } from "../lib/firewall/preflight.ts";
import { EXIT_BLOCKED, EXIT_REVIEW_HELD } from "../lib/firewall/policy.ts";

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
/* Guard                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * The CLI guard: run the shared preflight, then spawn npm only if it permits.
 *
 * The scan/verify/decide/audit logic lives in `lib/firewall/preflight.ts` so the
 * OpenCode plugin enforces the identical policy through the identical code. The
 * CLI's job is now only the part the plugin cannot do — actually running npm.
 */
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

  const result = await runPreflight({
    argv: commandArgv,
    source: "cli-guard",
    onProgress: (line) => {
      // Verdict and ERROR lines are indented under their coordinate; the
      // "scanning …" header sits one level out.
      if (/^(ALLOW|REVIEW|BLOCK|ERROR)\s/.test(line)) {
        out(`           ${c.dim(line)}`);
      } else {
        out(`  ${c.dim(line)}`);
      }
    },
  });

  if (!result.parsed) {
    // Command never parsed, so nothing was scanned and nothing can run.
    errOut(c.red(result.reason));
    return result.exitCode;
  }

  const { parsed } = result;

  errOutIfRejected(result.exitCode);
  printSummary(result.action, result.reason);

  if (!result.permit) {
    out(c.dim("  npm was NOT started."));
    return result.exitCode;
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

  out("");
  out(c.dim(`  npm exited with code ${code}.`));
  return code;
}

/** A rejected command is a user error, so it goes to stderr with context. */
function errOutIfRejected(exitCode: number): void {
  if (exitCode === EXIT_COMMAND_REJECTED) {
    errOut(c.yellow("  The command was rejected before scanning."));
  }
}

function printSummary(action: EnforcementAction, reason: string): void {
  out("");
  if (action === "ALLOWED_INSTALL") {
    out(c.green(`  ALLOW — ${reason}`));
  } else if (action === "REVIEW_HELD") {
    out(c.yellow(`  HELD — ${reason}`));
  } else {
    out(c.red(`  BLOCK — ${reason}`));
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    errOut(c.red(`d0 internal error: ${(e as Error).message}`));
    process.exitCode = 1;
  });