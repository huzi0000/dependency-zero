/**
 * Firewall enforcement tests.
 *
 * These prove the guard's decision logic and command rejection. No test in this
 * file spawns npm, and no test ever executes a fixture's malicious content.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandRejected, parseInstallCommand } from "../lib/firewall/parse-command.ts";
import {
  decide,
  EXIT_BLOCKED,
  EXIT_COMMAND_REJECTED,
  EXIT_REVIEW_HELD,
  EXIT_SCANNER_UNAVAILABLE,
} from "../lib/firewall/policy.ts";
import type { ScanResolution } from "../lib/scanner/types.ts";

function res(verdict: "allow" | "review" | "block"): ScanResolution {
  return {
    requested: "x",
    resolvedName: "x",
    resolvedVersion: "1.0.0",
    registry: "https://registry.npmjs.org",
    artifactSha256: "a".repeat(64),
    tarballBytes: 100,
    fileCount: 1,
    inspectedBytes: 100,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    scannerVersion: "test",
    policyVersion: "test",
    riskScore: 0,
    verdict,
    rationale: "test",
    findings: [],
    dependencies: { direct: [], transitiveResolved: false, note: "" },
    advisories: { state: "checked", vulnerabilities: [] },
    incompleteChecks: [],
  };
}

describe("command parsing", () => {
  it("accepts a plain npm install", () => {
    const p = parseInstallCommand(["npm", "install", "is-number@7.0.0"]);
    assert.deepEqual(p.coordinates, ["is-number@7.0.0"]);
    assert.deepEqual(p.args, ["install", "is-number@7.0.0"]);
  });

  it("accepts multiple packages", () => {
    const p = parseInstallCommand(["npm", "install", "is-number", "@scope/pkg@1.0.0"]);
    assert.deepEqual(p.coordinates, ["is-number", "@scope/pkg@1.0.0"]);
  });

  it("accepts npm's `i` alias", () => {
    assert.equal(parseInstallCommand(["npm", "i", "left-pad"]).coordinates[0], "left-pad");
  });

  it("forwards safe flags only", () => {
    const p = parseInstallCommand(["npm", "install", "--save-dev", "left-pad"]);
    assert.ok(p.args.includes("--save-dev"));
  });

  const rejected: [string[], string][] = [
    [["npm", "install", "is-number; calc.exe"], "D0_CMD_SHELL_METACHAR"],
    [["npm", "install", "is-number", "&&", "curl", "evil"], "D0_CMD_SHELL_METACHAR"],
    [["npm", "install", "$(whoami)"], "D0_CMD_SHELL_METACHAR"],
    [["npm", "install", "`id`"], "D0_CMD_SHELL_METACHAR"],
    [["npm", "install", "a", "|", "sh"], "D0_CMD_SHELL_METACHAR"],
    [["npm", "install", "../../etc/passwd"], "D0_CMD_PATH_TRAVERSAL"],
    [["npm", "install", "pkg", "--registry=https://evil.test"], "D0_CMD_FLAG_FORBIDDEN"],
    [["npm", "install", "-g", "pkg"], "D0_CMD_FLAG_GLOBAL"],
    [["npm", "install", "--ignore-scripts=false", "pkg"], "D0_CMD_FLAG_SCRIPTS"],
    [["npm", "install", "--unknown-flag", "pkg"], "D0_CMD_FLAG_UNKNOWN"],
    [["npm", "install", "--", "-e", "code"], "D0_CMD_DOUBLE_DASH"],
    [["npm", "publish", "pkg"], "D0_CMD_UNSUPPORTED_SUBCOMMAND"],
    [["npm", "exec", "evil"], "D0_CMD_UNSUPPORTED_SUBCOMMAND"],
    [["npm", "run", "build"], "D0_CMD_UNSUPPORTED_SUBCOMMAND"],
    [["npx", "evil"], "D0_CMD_NPX"],
    [["yarn", "add", "pkg"], "D0_CMD_NOT_NPM"],
    [["npm", "install"], "D0_CMD_NO_PACKAGES"],
    [["npm"], "D0_CMD_NO_SUBCOMMAND"],
    [[], "D0_CMD_EMPTY"],
    [["npm", "install", "file:./local"], "D0_CMD_BAD_COORDINATE"],
    [["npm", "install", "git+ssh://git@x/y"], "D0_CMD_BAD_COORDINATE"],
  ];

  for (const [argv, code] of rejected) {
    it(`rejects ${JSON.stringify(argv)} as ${code}`, () => {
      assert.throws(
        () => parseInstallCommand(argv),
        (e: unknown) => e instanceof CommandRejected && e.code === code,
        `expected ${code}`,
      );
    });
  }

  it("has no bypass flag", () => {
    // A documented, intentional property: there is no way to skip enforcement.
    const bypasses = ["--force", "--no-guard", "--skip-scan", "--yes", "-y"];
    for (const b of bypasses) {
      assert.throws(
        () => parseInstallCommand(["npm", "install", b, "pkg"]),
        CommandRejected,
        `${b} must not be accepted`,
      );
    }
  });
});

describe("enforcement policy", () => {
  it("permits install on ALLOW", () => {
    const d = decide(new Map([["pkg", res("allow")]]), ["pkg"]);
    assert.equal(d.permit, true);
    assert.equal(d.action, "ALLOWED_INSTALL");
    assert.equal(d.exitCode, 0);
  });

  it("blocks on BLOCK", () => {
    const d = decide(new Map([["pkg", res("block")]]), ["pkg"]);
    assert.equal(d.permit, false);
    assert.equal(d.action, "BLOCKED_BEFORE_EXECUTION");
    assert.equal(d.exitCode, EXIT_BLOCKED);
  });

  it("holds REVIEW without permitting install", () => {
    const d = decide(new Map([["pkg", res("review")]]), ["pkg"]);
    assert.equal(d.permit, false, "REVIEW must not auto-install");
    assert.equal(d.action, "REVIEW_HELD");
    assert.equal(d.exitCode, EXIT_REVIEW_HELD);
  });

  it("fails closed when a scan is missing", () => {
    const d = decide(new Map(), ["pkg"]);
    assert.equal(d.permit, false);
    assert.equal(d.exitCode, EXIT_SCANNER_UNAVAILABLE);
  });

  it("fails closed on a null resolution", () => {
    const d = decide(new Map([["pkg", null]]), ["pkg"]);
    assert.equal(d.permit, false, "an incomplete scan is never permission");
  });

  it("one blocked package blocks the whole batch", () => {
    const m = new Map([
      ["safe", res("allow")],
      ["evil", res("block")],
    ]);
    const d = decide(m, ["safe", "evil"]);
    assert.equal(d.permit, false);
    assert.ok(d.reason.includes("evil"));
  });

  it("BLOCK outranks REVIEW and ALLOW", () => {
    const m = new Map([
      ["a", res("allow")],
      ["b", res("review")],
      ["c", res("block")],
    ]);
    assert.equal(decide(m, ["a", "b", "c"]).exitCode, EXIT_BLOCKED);
    assert.equal(decide(new Map([["a", res("allow")], ["b", res("review")]]), ["a", "b"]).exitCode, EXIT_REVIEW_HELD);
  });

  it("uses distinct exit codes so an agent can branch", () => {
    const codes = new Set([
      decide(new Map([["p", res("block")]]), ["p"]).exitCode,
      decide(new Map([["p", res("review")]]), ["p"]).exitCode,
      decide(new Map(), ["p"]).exitCode,
      EXIT_COMMAND_REJECTED,
    ]);
    assert.equal(codes.size, 4, "each outcome needs its own exit code");
  });
});
