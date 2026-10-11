/**
 * Dependency Zero — npm install interception for OpenCode agents.
 *
 * WHAT THIS IS
 *
 * A pre-execution hook. When an agent asks OpenCode's shell tool to run an npm
 * package installation, Dependency Zero scans the named packages with the same
 * engine, the same policy and the same audit trail used everywhere else in this
 * project, and refuses the command before npm starts unless the verdict is
 * ALLOW. The agent does not have to remember to run `d0 guard` first.
 *
 * WHAT THIS IS NOT
 *
 * It is not universal agent security. It is a string match on one command, in
 * one shell tool, at one moment. It cannot see shell aliases, shell functions,
 * files sourced earlier, a different tool, a different agent, or any package
 * manager other than npm. See docs/OPENCODE_PLUGIN.md for the full boundary.
 *
 * NO NEW DEPENDENCY
 *
 * The published `@opencode/plugin` package is not a dependency of this project.
 * OpenCode V2 reads the default export's `id` and `setup()`, so the helper is
 * optional and the minimal surface used here is declared locally below. That
 * keeps the plugin loadable without adding anything to package.json, and makes
 * the exact contract this file depends on visible in one place.
 *
 *   Reference: https://opencode.ai/v2/docs/build/plugins
 */

import {
  classifyCommand,
  extractShellCommand,
  UNVERIFIABLE_INSTALL_SUBCOMMANDS,
} from "../../lib/firewall/agent-command.ts";
import { splitCommandString } from "../../lib/firewall/parse-command.ts";
import { runPreflight, type PreflightResult } from "../../lib/firewall/preflight.ts";
import type { ScanDeps } from "../../lib/scanner/scan.ts";
import type { FirewallEvent } from "../../lib/scanner/types.ts";

/* -------------------------------------------------------------------------- */
/* Minimal OpenCode plugin contract                                            */
/* -------------------------------------------------------------------------- */

/** Registration handle returned by every hook registration. */
interface Registration {
  dispose(): Promise<void>;
}

/** The single hook this plugin uses, as documented for V2. */
interface ToolExecuteBeforeEvent {
  readonly tool: string;
  input: Record<string, unknown>;
}

interface ToolHookContext {
  hook(
    name: "execute.before" | "execute.after",
    callback: (event: ToolExecuteBeforeEvent) => Promise<void> | void,
  ): Promise<Registration>;
}

interface PluginContext {
  tool: ToolHookContext;
  location: { directory: string };
  options?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Plugin options                                                              */
/* -------------------------------------------------------------------------- */

interface Options {
  /** Per-coordinate scan budget. Fail-closed if it expires. */
  timeoutMs: number;
  /** Set true to disable interception entirely. Documented, not recommended. */
  disabled: boolean;
  /**
   * Internal test seam. Not read from configuration.
   *
   * The test suite drives this exact hook, and without a seam every run would
   * append its scans to the real audit trail — making test data
   * indistinguishable from genuine enforcement history, which would undermine
   * the trail's whole value.
   */
  audit?: (event: FirewallEvent) => Promise<void>;
}

const DEFAULTS: Options = {
  timeoutMs: 120_000,
  disabled: false,
};

function readOptions(raw: Record<string, unknown> | undefined): Options {
  if (!raw) return DEFAULTS;
  const timeoutMs = typeof raw.timeoutMs === "number" && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULTS.timeoutMs;
  return {
    timeoutMs,
    disabled: raw.disabled === true,
    // Never sourced from configuration — only the test suite sets this.
    ...(typeof raw.audit === "function" ? { audit: raw.audit as Options["audit"] } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Blocking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Thrown to stop a command. OpenCode surfaces the message to the agent, so it
 * is written to explain what happened and what the human options are.
 */
class D0GuardBlocked extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "D0GuardBlocked";
    this.code = code;
  }
}

function banner(result: PreflightResult): string {
  const lines = [
    "",
    "DEPENDENCY ZERO — npm install was NOT run.",
    "",
    `  outcome : ${result.outcome}`,
    `  reason  : ${result.reason}`,
  ];
  if (result.coordinates.length > 0) lines.push(`  packages: ${result.coordinates.join(", ")}`);
  for (const d of result.details.slice(0, 8)) lines.push(`    - ${d}`);
  lines.push(
    "",
    "Review the Threat Report, then install manually if acceptable.",
    "There is no agent-side override flag by design.",
  );
  return lines.join("\n");
}

/**
 * Fail closed.
 *
 * Anything unexpected — a scanner crash, a store error, a bug in this file —
 * results in the command being blocked, never allowed. The reason distinguishes
 * a D0 refusal from a D0 malfunction so the human knows which one happened.
 */
function failClosed(detail: string): never {
  throw new D0GuardBlocked(
    "D0_GUARD_FAILED_CLOSED",
    [
      "",
      "DEPENDENCY ZERO — npm install was NOT run.",
      "",
      "  outcome : SCANNER_UNAVAILABLE",
      `  reason  : Dependency Zero could not verify this command: ${detail}`,
      "",
      "This is a failure of the guard, not a security finding. Nothing was installed.",
      "Retry once the scanner or registry is reachable, or install manually after review.",
    ].join("\n"),
  );
}

/* -------------------------------------------------------------------------- */
/* Core: decide and enforce                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run the preflight for a command already known to be in scope.
 *
 * Split out from the hook so the enforcement path can be exercised directly,
 * with no OpenCode runtime present. `deps` and `audit` exist for that reason:
 * tests inject a mock registry and a collector instead of writing scan results
 * into the real audit trail, which would otherwise make test runs
 * indistinguishable from genuine enforcement history.
 */
export async function enforceCommand(
  raw: string,
  options: Options,
  deps?: ScanDeps,
  audit?: (event: FirewallEvent) => Promise<void>,
): Promise<void> {
  let argv: string[];
  try {
    // Refuses shell syntax outright: chaining, substitution, redirection,
    // globbing and quoting all fail closed rather than being interpreted.
    argv = splitCommandString(raw);
  } catch (e) {
    throw new D0GuardBlocked("D0_GUARD_COMMAND_REJECTED", (e as Error).message);
  }

  // `npm ci` and friends install code D0 cannot enumerate in advance.
  const scope = classifyCommand(raw);
  const sub = scope.inScope ? scope.subcommand : null;
  if (sub && UNVERIFIABLE_INSTALL_SUBCOMMANDS.has(sub)) {
    throw new D0GuardBlocked(
      "D0_GUARD_UNVERIFIABLE_INSTALL",
      [
        "",
        "DEPENDENCY ZERO — npm install was NOT run.",
        "",
        `  outcome : COMMAND_REJECTED`,
        `  reason  : "npm ${sub}" installs packages Dependency Zero cannot verify before it runs.`,
        "",
        "D0 can only vet explicit package coordinates such as `npm install <pkg>@<version>`.",
        "Review the packages and install them manually, or install explicit coordinates here instead.",
      ].join("\n"),
    );
  }

  let result: PreflightResult;
  try {
    result = await runPreflight({
      argv,
      source: "opencode-plugin",
      timeoutMs: options.timeoutMs,
      ...(deps ? { deps } : {}),
      ...(audit ? { audit } : {}),
    });
  } catch (e) {
    return failClosed((e as Error).message);
  }

  if (result.permit) {
    // Deliberately a no-op. The original command is left byte-for-byte intact so
    // the agent's own shell runs it exactly once. Rewriting the command here
    // would risk a second install or a subtly different one.
    return;
  }

  throw new D0GuardBlocked("D0_GUARD_" + result.outcome, banner(result));
}

/* -------------------------------------------------------------------------- */
/* Plugin entrypoint                                                           */
/* -------------------------------------------------------------------------- */

export default {
  id: "dependency-zero.npm-guard",

  async setup(ctx: PluginContext): Promise<void> {
    const options = readOptions(ctx.options);

    await ctx.tool.hook("execute.before", async (event) => {
      if (options.disabled) return;

      // Only act on shell tools we recognise, and only when a command string is
      // present. An unfamiliar shape is passed through untouched.
      const raw = extractShellCommand(event.tool, event.input);
      if (raw === null) return;

      const scope = classifyCommand(raw);
      if (!scope.inScope) return;

      await enforceCommand(raw, options, undefined, options.audit);
    });
  },
};