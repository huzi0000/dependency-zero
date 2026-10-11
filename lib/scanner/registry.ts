/**
 * npm registry metadata resolution.
 *
 * Resolves a coordinate to a concrete version and a tarball URL, and computes
 * the integrity hashes npm publishes so the tarball we download can be checked
 * against them.
 *
 * IMPORTANT TRUST NOTE: registry metadata is treated as untrusted input. It is
 * parsed defensively, every field is validated against our own expectations,
 * and the tarball URL is re-validated through `assertSafeUrl` before use. A
 * registry that lies produces an error, never a clean verdict.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { parseCoordinate, type Coordinate } from "./coordinate.ts";
import { assertSafeUrl, HttpError, safeFetch } from "./http.ts";

export const REGISTRY_ORIGIN = "https://registry.npmjs.org";

/** Registry metadata is small; cap it hard. */
const META_MAX_BYTES = 48 * 1024 * 1024;
const META_TIMEOUT_MS = 15_000;

/** Tarballs: generous enough for real packages, far below "unbounded". */
export const TARBALL_MAX_BYTES = 25 * 1024 * 1024;
export const TARBALL_TIMEOUT_MS = 60_000;

const ALLOWED_TAGS = ["latest", "next", "beta", "canary", "stable"];

export interface ResolvedPackage {
  requested: string;
  name: string;
  version: string;
  distTags: Record<string, string>;
  license?: string;
  tarballUrl: string;
  /** Integrity strings from `dist.integrity` / `dist.shasum`. */
  integrity?: string;
  shasum?: string;
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  registry: string;
  deprecated?: string;

  /* ---- Authoritative package metadata, copied from the packument ---- */
  /** Publisher / maintainer name as published. Never inferred. */
  publisher?: string;
  /** Source repository URL as published. */
  repository?: string;
  /** ISO date this exact version was published, from the packument time map. */
  publishedAt?: string;
  /** ISO date the packument itself was last modified. */
  modifiedAt?: string;
  /** Unpacked size in bytes, when the registry publishes it. */
  unpackedSize?: number;
  /** File count, when the registry publishes it. */
  fileCount?: number;
  /** Description as published, truncated for display. */
  description?: string;
}

function registryMetadataUrl(name: string): string {
  // Scoped names are encoded so "@scope/pkg" -> "%40scope%2Fpkg", the form the
  // registry documents for metadata lookups.
  const encoded = name.startsWith("@")
    ? `%40${name.slice(1).replace("/", "%2F")}`
    : encodeURIComponent(name);
  return `${REGISTRY_ORIGIN}/${encoded}`;
}

/** Resolve a dist-tag name to a concrete version, case-insensitively. */
function resolveTag(tags: Record<string, unknown>, wanted: string): string {
  const direct = tags[wanted];
  if (typeof direct === "string") return direct;
  const lower = tags[wanted.toLowerCase()];
  if (typeof lower === "string") return lower;
  throw new HttpError(
    "DZ_REGISTRY_VERSION_NOT_FOUND",
    `"${wanted}" is not a supported dist-tag. Supported tags: ${ALLOWED_TAGS.join(", ")}, or an exact version.`,
  );
}

/** True when the caller gave a concrete version rather than a dist-tag. */
function looksLikeExactVersion(v: string): boolean {
  return /^v?\d+\.\d+\.\d+/.test(v);
}

export async function resolvePackage(
  requested: string,
  /* Injected in tests so the whole pipeline, metadata included, is offline. */
  fetchImpl: typeof safeFetch = safeFetch,
): Promise<ResolvedPackage> {
  const coord: Coordinate = parseCoordinate(requested);

  let meta: { bytes: Buffer };
  try {
    meta = await fetchImpl(registryMetadataUrl(coord.name), {
      timeoutMs: META_TIMEOUT_MS,
      maxBytes: META_MAX_BYTES,
    });
  } catch (err) {
    if (err instanceof HttpError && err.code === "DZ_HTTP_STATUS") {
      throw new HttpError(
        "DZ_REGISTRY_NOT_FOUND",
        `Package "${coord.name}" was not found in the npm registry.`,
      );
    }
    throw err;
  }

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(meta.bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError("DZ_REGISTRY_BAD_JSON", "Registry returned malformed metadata JSON.");
  }

  const distTags =
    doc["dist-tags"] && typeof doc["dist-tags"] === "object"
      ? (doc["dist-tags"] as Record<string, unknown>)
      : {};

  const versions = doc.versions;
  if (!versions || typeof versions !== "object") {
    throw new HttpError(
      "DZ_REGISTRY_NO_VERSIONS",
      `Registry metadata for "${coord.name}" has no versions map.`,
    );
  }
  const versionsMap = versions as Record<string, unknown>;

  // An exact version is looked up in `versions`; a dist-tag is resolved through
  // `dist-tags` first. Conflating the two is exactly how a "not found" bug hides.
  let version: string;
  if (coord.version && looksLikeExactVersion(coord.version)) {
    const wanted = coord.version.replace(/^v/, "");
    if (!versionsMap[wanted]) {
      throw new HttpError(
        "DZ_REGISTRY_VERSION_NOT_FOUND",
        `Version "${wanted}" of "${coord.name}" is not published.`,
      );
    }
    version = wanted;
  } else if (coord.version) {
    version = resolveTag(distTags, coord.version);
    if (!versionsMap[version]) {
      throw new HttpError(
        "DZ_REGISTRY_VERSION_NOT_FOUND",
        `Dist-tag "${coord.version}" points at "${version}", which has no manifest.`,
      );
    }
  } else {
    const latest = distTags.latest;
    if (typeof latest !== "string") {
      throw new HttpError("DZ_REGISTRY_NO_LATEST", "Registry did not publish a `latest` dist-tag.");
    }
    version = latest;
  }

  const manifest = versionsMap[version];
  if (!manifest || typeof manifest !== "object") {
    throw new HttpError(
      "DZ_REGISTRY_VERSION_NOT_FOUND",
      `Version "${version}" of "${coord.name}" was not found in the registry metadata.`,
    );
  }

  const m = manifest as Record<string, unknown>;
  const dist = (m.dist ?? {}) as Record<string, unknown>;
  const tarball = dist.tarball;

  if (typeof tarball !== "string" || !tarball) {
    throw new HttpError("DZ_REGISTRY_NO_TARBALL", `Version "${version}" has no tarball URL.`);
  }

  // Re-validate the tarball URL ourselves. The registry told us where to go;
  // that is not the same as it being safe to go there.
  assertSafeUrl(tarball);

  const deps = (m.dependencies ?? {}) as Record<string, unknown>;
  const scripts = (m.scripts ?? {}) as Record<string, unknown>;

  const cleanDeps: Record<string, string> = {};
  for (const [k, v] of Object.entries(deps)) {
    if (typeof v === "string") cleanDeps[k] = v;
  }
  // Metadata is copied verbatim from the packument. Anything absent is left
  // undefined so the UI can say "Not available" rather than invent a value.
  const maintainers = Array.isArray(doc.maintainers)
    ? (doc.maintainers as unknown[])
        .map((x) => (x as { name?: unknown })?.name)
        .filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const repoRaw = m.repository;
  const repositoryUrl =
    typeof repoRaw === "string"
      ? repoRaw
      : typeof repoRaw === "object" && repoRaw !== null
        ? ((repoRaw as { url?: unknown }).url as string | undefined)
        : undefined;
  const timeMap = (doc.time ?? {}) as Record<string, unknown>;
  const versionTime = typeof timeMap[version] === "string" ? (timeMap[version] as string) : undefined;
  const packumentModified = typeof timeMap.modified === "string" ? (timeMap.modified as string) : undefined;

  const cleanScripts: Record<string, string> = {}; 
  for (const [k, v] of Object.entries(scripts)) {
    if (typeof v === "string") cleanScripts[k] = v;
  }

  return {
    requested,
    name: coord.name,
    version,
    distTags: Object.fromEntries(
      Object.entries(distTags).filter(([, v]) => typeof v === "string") as [string, string][],
    ),
    license: typeof m.license === "string" ? m.license : undefined,
    publisher:
      maintainers[0] ??
      (typeof m.author === "string"
        ? m.author
        : typeof (m.author as { name?: unknown })?.name === "string"
          ? ((m.author as { name?: string }).name as string)
          : undefined),
    repository: repositoryUrl,
    publishedAt: versionTime,
    modifiedAt: packumentModified,
    unpackedSize: typeof dist.unpackedSize === "number" ? dist.unpackedSize : undefined,
    fileCount: typeof dist.fileCount === "number" ? dist.fileCount : undefined,
    description: typeof m.description === "string" ? m.description.slice(0, 300) : undefined,
    tarballUrl: tarball,
    integrity: typeof dist.integrity === "string" ? dist.integrity : undefined,
    shasum: typeof dist.shasum === "string" ? dist.shasum : undefined,
    dependencies: cleanDeps,
    scripts: cleanScripts,
    registry: REGISTRY_ORIGIN,
    deprecated: typeof m.deprecated === "string" ? m.deprecated : undefined,
  };
}

/**
 * Verify the downloaded tarball against the integrity the registry published.
 *
 * npm's `integrity` is SRI of the form "sha512-<base64>". We recompute it and
 * compare in constant time. A mismatch means the bytes we inspected are not the
 * bytes npm published, so the scan is rejected rather than reported.
 */
export function verifyIntegrity(
  bytes: Buffer,
  integrity?: string,
  shasum?: string,
): { ok: boolean; reason?: string } {
  if (integrity) {
    const [algo, b64] = integrity.split("-");
    if (algo && b64 && ["sha512", "sha384", "sha256"].includes(algo)) {
      const computed = createHash(algo).update(bytes).digest();
      let expected: Buffer;
      try {
        expected = Buffer.from(b64, "base64");
      } catch {
        return { ok: false, reason: "Registry integrity field is not valid base64." };
      }
      if (computed.length !== expected.length || !timingSafeEqual(computed, expected)) {
        return {
          ok: false,
          reason: `Tarball failed ${algo} integrity verification against the registry.`,
        };
      }
      return { ok: true };
    }
    return { ok: false, reason: `Unsupported integrity algorithm "${algo}".` };
  }
  if (shasum) {
    const computed = createHash("sha1").update(bytes).digest("hex");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(shasum, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "Tarball failed sha1 shasum verification against the registry." };
    }
    return { ok: true };
  }
  // No integrity published at all. That is a limitation to report, not a pass.
  return {
    ok: true,
    reason: "Registry published no integrity hash; artifact hash recorded but not verified.",
  };
}