/**
 * npm install command parser for the firewall.
 *
 * SECURITY CRITICAL. This module decides what will and will not be executed. Its
 * job is to be extremely conservative: anything it does not fully understand is
 * REJECTED, never passed through.
 *
 * Specifically rejected:
 *   - any shell metacharacter (`; | & $ ` > < \n \\ " '`) — an agent must not be
 *     able to smuggle a second command past the guard
 *   - command chaining and subshells
 *   - npm lifecycle subcommands (publish, exec, run, init, ...) — these execute
 *     arbitrary code and are out of scope for an install guard
 *   - flags that alter resolution or execute code (-g/--global, --ignore-scripts
 *     is allowed as it REDUCES risk, --registry pointing elsewhere, etc.)
 *   - multiple positional packages beyond a small bounded count
 *
 * Accepted surface is deliberately narrow: `npm install [flags] <pkg>[@ver]...`
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseCoordinate, CoordinateError } from "../scanner/coordinate.ts";

export class CommandRejected extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommandRejected";
    this.code = code;
  }
}

export interface ParsedInstall {
  /** npm binary to execute. */
  program: string;
  /** Arguments to pass to npm, excluding the subcommand. */
  args: string[];
  /** Validated coordinates to scan. */
  coordinates: string[];
  /** Echoed back for the audit trail. Never a shell string. */
  argv: string[];
}

/** Any of these means the caller is trying to run more than an install. */
const DANGEROUS_SUBCOMMANDS = new Set([
  "publish", "unpublish", "exec", "x", "run", "run-script", "init", "login",
  "logout", "adduser", "owner", "whoami", "token", "access", "profile",
  "audit", "doctor", "link", "unlink", "dedupe", "pack", "dist-tag", "star",
  "unstar", "deprecate", "fund", "repo", "help", "explore", "completion",
]);

/** Flags that are acceptable: read-only or risk-reducing. */
const SAFE_FLAGS = new Set([
  "--save", "--save-exact", "--no-save", "--save-prod", "--save-dev",
  "--save-optional", "--save-peer", "--dry-run", "--ignore-scripts",
  "--package-lock-only", "--no-audit", "--no-fund", "--prefer-offline",
]);

const SHORT_SAFE_FLAGS = new Set(["-S", "-E", "-D", "-O", "-g"]); // -g intentionally rejected below

/** Flags that must never be forwarded. */
const FORBIDDEN_FLAGS = new Set([
  "--registry", "--global", "-g", "--prefix", "--cache", "--userconfig",
  "--globalconfig", "--script-shell", "--node-options", "--ignore-scripts=false",
]);

/** Characters that could break out of argv into a shell. */
export const SHELL_METACHARS = /[;&|`$<>\n\r\\"'(){}[\]*?!#~]/;

/**
 * Turn a raw shell command string into an argument vector, refusing shell syntax.
 *
 * An agent's shell tool receives a STRING, while `parseInstallCommand` wants an
 * argv array. Bridging the two by naive splitting is where a guard gets bypassed:
 * `npm install a && curl evil` splits into tokens that look harmless. So this
 * refuses the whole string up front when it contains ANY shell metacharacter,
 * and only ever splits on whitespace. There is no quote handling, no expansion,
 * no substitution and no globbing — by design. A caller that needs those must
 * be handled by a human, not by guessing here.
 *
 * Quoting is therefore rejected rather than interpreted: `npm install "pkg"`
 * fails closed with a message telling the caller to pass plain arguments.
 */
export function splitCommandString(raw: string): string[] {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new CommandRejected("D0_CMD_EMPTY", "Rejected: empty command.");
  }
  assertNoMetachars([raw]);
  const tokens = raw.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new CommandRejected("D0_CMD_EMPTY", "Rejected: empty command.");
  }
  return tokens;
}

function assertNoMetachars(raw: string[]): void {
  for (const a of raw) {
    if (SHELL_METACHARS.test(a)) {
      throw new CommandRejected(
        "D0_CMD_SHELL_METACHAR",
        `Rejected: argument contains shell metacharacters: ${JSON.stringify(a)}. ` +
          `The firewall does not accept shell syntax; pass plain arguments.`,
      );
    }
    if (a.includes("..")) {
      throw new CommandRejected(
        "D0_CMD_PATH_TRAVERSAL",
        `Rejected: argument contains a path traversal: ${JSON.stringify(a)}.`,
      );
    }
  }
}

/**
 * Parse `npm install ...` from an argv array.
 *
 * `argv` is expected to be the argument vector as an AI agent or shell would
 * produce it, e.g. ["npm", "install", "is-number@7.0.0"].
 */
export function parseInstallCommand(argv: string[]): ParsedInstall {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new CommandRejected("D0_CMD_EMPTY", "No command given.");
  }

  // Reject anything that is not a direct npm invocation.
  const program = argv[0];
  const base = program.replace(/\.(exe|cmd|bat)$/i, "").split(/[\\/]/).pop()?.toLowerCase();
  if (base !== "npm" && base !== "npx") {
    throw new CommandRejected(
      "D0_CMD_NOT_NPM",
      `Rejected: only npm commands can be guarded, got "${program}".`,
    );
  }
  if (base === "npx") {
    throw new CommandRejected(
      "D0_CMD_NPX",
      "Rejected: npx executes arbitrary packages by design and cannot be safely guarded.",
    );
  }

  assertNoMetachars(argv);

  const rest = argv.slice(1);
  if (rest.length === 0) {
    throw new CommandRejected(
      "D0_CMD_NO_SUBCOMMAND",
      `Rejected: no npm subcommand. Supported: "npm install <package>".`,
    );
  }

  const [subcommand, ...tail] = rest;

  if (subcommand.startsWith("-")) {
    throw new CommandRejected(
      "D0_CMD_NO_SUBCOMMAND",
      `Rejected: missing install subcommand. Supported: "npm install <package>".`,
    );
  }
  if (subcommand !== "install" && subcommand !== "i") {
    if (DANGEROUS_SUBCOMMANDS.has(subcommand)) {
      throw new CommandRejected(
        "D0_CMD_UNSUPPORTED_SUBCOMMAND",
        `Rejected: "npm ${subcommand}" is outside the guarded install surface. ` +
          `Only "npm install" is enforced by this tool.`,
      );
    }
    throw new CommandRejected(
      "D0_CMD_UNSUPPORTED_SUBCOMMAND",
      `Rejected: unsupported npm subcommand "${subcommand}". Use "npm install <package>".`,
    );
  }

  const forwardArgs: string[] = [];
  const coordinates: string[] = [];
  const MAX_PACKAGES = 25;
  let sawDoubleDash = false;

  for (const arg of tail) {
    if (arg === "--") {
      sawDoubleDash = true;
      continue;
    }
    if (sawDoubleDash) {
      // Anything after `--` is opaque to npm; refuse to reason about it.
      throw new CommandRejected(
        "D0_CMD_DOUBLE_DASH",
        `Rejected: arguments after "--" are not inspectable: ${JSON.stringify(arg)}.`,
      );
    }

    if (arg.startsWith("-")) {
      // Specific checks first, so these branches stay reachable rather than
      // being swallowed by the generic forbidden-flag test below.
      if (arg.startsWith("--ignore-scripts=false")) {
        throw new CommandRejected(
          "D0_CMD_FLAG_SCRIPTS",
          "Rejected: re-enabling lifecycle scripts defeats the point of the guard.",
        );
      }
      if (arg === "-g" || arg === "--global") {
        throw new CommandRejected(
          "D0_CMD_FLAG_GLOBAL",
          "Rejected: global installs are outside the guarded surface.",
        );
      }
      if (FORBIDDEN_FLAGS.has(arg) || arg.startsWith("--registry=")) {
        throw new CommandRejected(
          "D0_CMD_FLAG_FORBIDDEN",
          `Rejected: flag "${arg}" can redirect installation to an untrusted source.`,
        );
      }
      // Split --flag=value form for validation.
      const eq = arg.indexOf("=");
      const flagName = eq === -1 ? arg : arg.slice(0, eq);
      if (!SAFE_FLAGS.has(flagName) && !SHORT_SAFE_FLAGS.has(flagName)) {
        // Unknown flags are refused rather than forwarded blind.
        throw new CommandRejected(
          "D0_CMD_FLAG_UNKNOWN",
          `Rejected: unrecognised flag "${arg}". The guard only forwards a known-safe flag set.`,
        );
      }
      if (flagName === "--package-lock-only") {
        throw new CommandRejected(
          "D0_CMD_FLAG_DRY_ONLY",
          "Rejected: --package-lock-only does not install, so there is nothing to guard.",
        );
      }
      forwardArgs.push(arg);
      continue;
    }

    if (coordinates.length >= MAX_PACKAGES) {
      throw new CommandRejected(
        "D0_CMD_TOO_MANY",
        `Rejected: more than ${MAX_PACKAGES} packages in a single guarded install.`,
      );
    }

    let coord;
    try {
      coord = parseCoordinate(arg);
    } catch (err) {
      if (err instanceof CoordinateError) {
        throw new CommandRejected("D0_CMD_BAD_COORDINATE", `Rejected: ${err.message}`);
      }
      throw err;
    }
    coordinates.push(coord.version ? `${coord.name}@${coord.version}` : coord.name);
    forwardArgs.push(arg);
  }

  if (coordinates.length === 0) {
    throw new CommandRejected(
      "D0_CMD_NO_PACKAGES",
      `Rejected: no package specified. Usage: d0 guard -- npm install <package>`,
    );
  }

  return {
    program: "npm",
    args: ["install", ...forwardArgs],
    coordinates,
    argv: [...argv],
  };
}

/**
 * Resolve how to invoke npm WITHOUT a shell.
 *
 * Two platform problems, both solved without ever enabling `shell: true`:
 *
 *  1. On Windows `npm` is a `.cmd` shim that `spawn(shell:false)` cannot
 *     resolve (ENOENT).
 *  2. Node >= 18.20.2 additionally REFUSES to spawn `.cmd`/`.bat` without a
 *     shell, as the fix for CVE-2024-27980, returning EINVAL.
 *
 * Enabling a shell would re-open argument injection, which is precisely what
 * this firewall exists to prevent. Instead we run npm's JavaScript entry point
 * with the current Node executable. Same npm, no shell, argument array intact.
 */
export function npmInvocation(): { program: string; prefixArgs: string[] } {
  const candidates: string[] = [];

  // When invoked via `npm run`, npm tells us its own entry point.
  const execPath = process.env.npm_execpath;
  if (execPath && /\.js$/i.test(execPath)) candidates.push(execPath);

  // Sibling of the running node binary: <prefix>/node_modules/npm/bin/npm-cli.js
  const nodeDir = dirname(process.execPath);
  candidates.push(
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { program: process.execPath, prefixArgs: [candidate] };
    }
  }

  // Last resort on POSIX, where `npm` is a real executable and needs no shim.
  return { program: process.platform === "win32" ? "npm.cmd" : "npm", prefixArgs: [] };
}