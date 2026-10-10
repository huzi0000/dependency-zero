/**
 * Strict npm coordinate parsing.
 *
 * This parser is deliberately restrictive. A firewall that silently
 * misinterprets a coordinate is worse than one that refuses it, so anything we
 * cannot prove is a plain registry name@version is rejected rather than
 * guessed at.
 *
 * Explicitly NOT supported (and rejected, not interpreted):
 *   - git URLs / ssh / github: shorthands
 *   - file: and local paths
 *   - remote tarball URLs (http(s)://...tgz)
 *   - npm aliases (alias@npm:name@version)
 *   - workspace: protocol
 *   - URL-encoded or path-like names
 */

export interface Coordinate {
  /** Bare package name, lowercased, including any @scope prefix. */
  name: string;
  /** Requested version, or null when the caller asked for a dist-tag/latest. */
  version: string | null;
  /** True when no explicit version was supplied. */
  isDistTag: boolean;
}

/** Lowercase, URL-safe, optionally scoped. Mirrors npm's own package rules. */
const NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Semver-ish, and nothing that could smuggle a path or scheme. */
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

/** Dist-tags we are willing to resolve. Anything else is refused. */
const ALLOWED_TAGS = new Set(["latest", "next", "beta", "canary", "stable"]);

export class CoordinateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CoordinateError";
    this.code = code;
  }
}

function rejectUnsupported(input: string): void {
  const lower = input.toLowerCase();
  const unsupported: [RegExp, string, string][] = [
    [/^(https?|git|git\+ssh|ssh):\/\//, "DZ_COORD_REMOTE_URL", "remote URLs are not supported"],
    [/^github:/, "DZ_COORD_REMOTE_URL", "github shorthands are not supported"],
    [/^file:/, "DZ_COORD_LOCAL_PATH", "local file paths are not supported"],
    [/^link:|^portal:/, "DZ_COORD_LOCAL_PATH", "link/portal protocols are not supported"],
    [/^workspace:/, "DZ_COORD_WORKSPACE", "workspace: protocol is not supported"],
    // Matched anywhere, not just at the start: the alias form is
    // `alias@npm:real-pkg`, so the marker sits in the version position. A colon
    // is not a legal package-name character, so this cannot false-positive.
    [/npm:/, "DZ_COORD_ALIAS", "npm: aliases are not supported"],
    [/^[a-z]:[\\/]/, "DZ_COORD_LOCAL_PATH", "absolute Windows paths are not supported"],
    [/^[\\/]{1,2}/, "DZ_COORD_LOCAL_PATH", "absolute paths are not supported"],
    [/^[.~]{1,2}[\\/]/, "DZ_COORD_LOCAL_PATH", "relative paths are not supported"],
    [/\.tgz($|[?#])/i, "DZ_COORD_TARBALL_URL", "direct tarball URLs are not supported"],
    [/[\s;|&`$><]/, "DZ_COORD_SHELL_METACHAR", "shell metacharacters are not allowed"],
    [/%2f|%5c/i, "DZ_COORD_ENCODED", "encoded path separators are not allowed"],
  ];
  for (const [re, code, message] of unsupported) {
    if (re.test(lower)) {
      throw new CoordinateError(code, `Unsupported package specifier: ${message}.`);
    }
  }
}

/**
 * Parse a coordinate like `is-number`, `is-number@7.0.0`, `@scope/pkg@1.2.3`.
 *
 * Scoped packages are handled by splitting on the LAST `@`, because the first
 * character may itself be the scope marker.
 */
export function parseCoordinate(input: string): Coordinate {
  const raw = (input ?? "").trim();
  if (!raw) {
    throw new CoordinateError("DZ_COORD_EMPTY", "Enter a package coordinate, e.g. is-number@7.0.0.");
  }
  if (raw.length > 214) {
    throw new CoordinateError("DZ_COORD_TOO_LONG", "Package coordinate is too long.");
  }
  rejectUnsupported(raw);

  const at = raw.lastIndexOf("@");

  // No "@" at all, or the only "@" is the scope marker => no version given.
  if (at <= 0) {
    const name = raw.toLowerCase();
    if (!NAME_RE.test(name)) {
      throw new CoordinateError("DZ_COORD_INVALID_NAME", `Not a valid npm package name: ${raw}`);
    }
    return { name, version: null, isDistTag: true };
  }

  const name = raw.slice(0, at).toLowerCase();
  const version = raw.slice(at + 1);

  if (!NAME_RE.test(name)) {
    throw new CoordinateError("DZ_COORD_INVALID_NAME", `Not a valid npm package name: ${name}`);
  }
  if (!version) {
    throw new CoordinateError("DZ_COORD_INVALID_VERSION", `Not a valid version for ${name}.`);
  }

  // A bare word is treated as a dist-tag only when it is one we allow; this
  // stops `pkg@main` or `pkg@../evil` being treated as a version string.
  if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(version) && !VERSION_RE.test(version)) {
    throw new CoordinateError("DZ_COORD_INVALID_VERSION", `Not a valid version: ${version}`);
  }
  if (!VERSION_RE.test(version)) {
    throw new CoordinateError("DZ_COORD_INVALID_VERSION", `Not a valid version: ${version}`);
  }

  const looksNumeric = /^v?\d/.test(version);
  if (!looksNumeric && !ALLOWED_TAGS.has(version.toLowerCase())) {
    throw new CoordinateError(
      "DZ_COORD_UNSUPPORTED_TAG",
      `Unsupported dist-tag "${version}". Supported tags: ${[...ALLOWED_TAGS].join(", ")}, or an exact version.`,
    );
  }

  return { name, version, isDistTag: !looksNumeric };
}
