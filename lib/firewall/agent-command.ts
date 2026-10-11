/**
 * Deciding whether an agent's shell command is Dependency Zero's business.
 *
 * This module answers one question: is this command an attempt to install npm
 * packages that D0 must vet before it runs? It never scans and never executes.
 * Keeping it separate from `preflight.ts` means the "is this ours?" judgement
 * can be tested exhaustively without a network, a store or an agent harness.
 *
 * THE POSTURE
 *
 * Two failure modes matter and they pull in opposite directions:
 *
 *   - Interception is too narrow  -> a malicious install walks through.
 *   - Interception is too broad  -> ordinary work (`npm test`) is blocked and
 *                                   the guard is switched off as noise.
 *
 * The rule below resolves that with an explicit allowlist of subcommands that
 * provably do not install, and treats EVERYTHING ELSE that mentions npm as in
 * scope. When in doubt it is in scope, and in-scope commands that D0 cannot
 * fully verify are held rather than waved through.
 *
 * WHAT THIS IS NOT
 *
 * A string match on one command, in one shell tool, for one moment. It does not
 * see shell aliases, shell functions, files sourced before the command, another
 * agent, another tool, or a package manager other than npm. Those limits are
 * documented in docs/OPENCODE_PLUGIN.md rather than papered over here.
 */

/** Tool names that run a shell command. V2 names it `shell`; `bash` is common. */
export const SHELL_TOOL_NAMES = new Set(["shell", "bash"]);

/**
 * npm subcommands that provably do NOT install packages.
 *
 * These are let through untouched. The list is deliberately short: anything not
 * named here is treated as in scope, so adding an entry here is a decision to
 * declare a command safe, and should be made only with that in mind.
 */
const NON_INSTALL_SUBCOMMANDS = new Set([
  // Run a script or a lifecycle command — nothing new is fetched.
  "run", "run-script", "test", "start", "stop", "restart",
  // Read-only inspection.
  "ls", "list", "ll", "la", "view", "info", "why", "explain", "outdated",
  "audit", "sbom", "search", "s", "ping",
  "version", "help", "doctor", "fund", "bin", "root", "prefix",
  // Config, cache and scaffolding. No package is fetched.
  "config", "cache", "profile", "init",
  // Account and publishing. No packages are installed.
  "publish", "unpublish", "login", "logout", "adduser", "owner", "token",
  "access", "whoami", "dist-tag", "star", "unstar", "deprecate", "repo",
  "explore", "completion", "docs",
  // Link a local directory. No registry package is fetched.
  "link", "unlink",
  // Tarball creation from the local tree.
  "pack",
]);

/** Does this token name npm or npx? Handles `npm`, `npm.cmd`, `/usr/bin/npm`. */
function isNpmToken(token: string): boolean {
  const base = token.split(/[\\/]/).pop() ?? "";
  return /^(npm|npx)(\.(?:cmd|exe|bat))?$/i.test(base);
}

/**
 * An npm token written with a path.
 *
 * A bare `npm` in a later argument is usually just text — `grep npm install src/`
 * is someone searching the code, not someone installing. But a *pathed* npm token
 * is almost always a real invocation, including the Windows form whose path
 * contains a space and would otherwise be split into two tokens.
 */
function isPathedNpmToken(token: string): boolean {
  return /[\\/]/.test(token) && isNpmToken(token);
}

/**
 * Split a command into the segments a shell would run separately.
 *
 * Used only for DETECTION. It exists so that `echo hi; npm install evil` is
 * recognised as containing an install, rather than the whole string being
 * treated as one opaque command.
 */
const SEGMENT_BOUNDARY = /\|\||&&|\||;|&|`|\$\(|\n/;

export type ScopeVerdict =
  /** Not an npm package install. Pass through untouched. */
  | { inScope: false; reason: string }
  /** An npm package install attempt that D0 must vet. */
  | { inScope: true; subcommand: string | null };

/**
 * Decide whether a raw command string is an npm install attempt.
 *
 * npm must appear in COMMAND POSITION — the first real token of a shell
 * segment, after any `VAR=value` prefix. Matching the word "npm" anywhere would
 * be wrong in both directions: it would let `echo npm install` look like an
 * install attempt, and it would drag harmless searching along, because
 * `grep "npm install" src/` contains the text but starts no npm process.
 *
 * Command position is also what makes chained attacks visible:
 * `cd x && npm install evil` and `$(npm install evil)` both put npm first in
 * their segment.
 *
 * An unknown subcommand counts as in scope, because "I have never heard of this
 * subcommand" is exactly the state in which guessing is dangerous.
 */
export function classifyCommand(raw: unknown): ScopeVerdict {
  if (typeof raw !== "string") {
    return { inScope: false, reason: "command input is not a string" };
  }

  let sawNpm = false;

  for (const segment of raw.split(SEGMENT_BOUNDARY)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    // Skip leading environment assignments: `NODE_ENV=x npm install y`.
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    if (i >= tokens.length) continue;

    // npm must lead the segment, or appear as a pathed token whose directory
    // happens to contain a space and split it in two.
    let npmAt = -1;
    if (isNpmToken(tokens[i])) {
      npmAt = i;
    } else {
      const pathed = tokens.findIndex((t, idx) => idx > i && isPathedNpmToken(t));
      if (pathed !== -1) npmAt = pathed;
    }
    if (npmAt === -1) continue;
    sawNpm = true;

    // Skip flags to find the subcommand. `npm --save foo` means `npm install foo`,
    // so "foo" is treated as an unknown subcommand and stays in scope.
    let sub: string | null = null;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].startsWith("-")) continue;
      sub = tokens[j].toLowerCase();
      break;
    }

    if (sub && NON_INSTALL_SUBCOMMANDS.has(sub)) continue;
    return { inScope: true, subcommand: sub };
  }

  if (sawNpm) {
    return { inScope: false, reason: "npm appears only in non-install subcommands" };
  }
  return { inScope: false, reason: "no npm invocation in command position" };
}

/**
 * Extract the command string from a tool input, or null when the shape is not
 * one this plugin understands.
 *
 * Returning null for an unrecognised shape is deliberate: the plugin only acts
 * on a shell tool it recognises, so it cannot accidentally block an unrelated
 * tool that happens to carry a field called "command".
 */
export function extractShellCommand(tool: unknown, input: unknown): string | null {
  if (typeof tool !== "string" || !SHELL_TOOL_NAMES.has(tool)) return null;
  if (!input || typeof input !== "object") return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

/**
 * npm subcommands that install packages but cannot be pre-verified.
 *
 * These install code D0 never scanned: `ci` resolves a lockfile, `update` acts
 * on whatever is already in node_modules. D0 has no way to know what they will
 * fetch without running them, and running them to find out would defeat the
 * purpose. They are held with an explanation rather than silently waved through.
 */
export const UNVERIFIABLE_INSTALL_SUBCOMMANDS = new Set([
  "ci", "update", "upgrade", "install-test", "rebuild",
]);