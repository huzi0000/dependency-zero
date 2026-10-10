/**
 * Bounded, in-memory tarball inspection.
 *
 * The tarball is treated as hostile input throughout. We never extract to disk,
 * never spawn `tar`, never follow symlinks, and never execute anything.
 *
 * The tar format is parsed directly rather than shelling out, which is what
 * lets us enforce hard bounds at every step and reject unsafe entries instead
 * of writing them somewhere dangerous.
 *
 * Enforced limits:
 *   - entry count, expanded total bytes, per-entry bytes
 *   - path length and component depth
 *   - absolute paths, `..` traversal, backslashes, NUL bytes
 *   - symlink/hardlink/device/FIFO entries (recorded, never followed)
 *   - inspection wall-clock budget
 */

import { gunzipSync } from "node:zlib";

/** npm tarballs are gzip. Anything else is refused rather than sniffed. */
const GZIP_MAGIC = [0x1f, 0x8b];

const BLOCK_SIZE = 512;

export const TARBALL_LIMITS = {
  maxEntries: 10_000,
  maxExpandedBytes: 120 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
  maxPathLength: 512,
  maxPathDepth: 24,
  maxTimeMs: 20_000,
} as const;

export type EntryKind = "file" | "directory" | "symlink" | "hardlink" | "other";

export interface TarEntry {
  /** Normalised, validated path as it appears in the archive. */
  path: string;
  kind: EntryKind;
  /** Only populated for `file` entries. */
  bytes?: Buffer;
  size: number;
  /** Link target for symlink/hardlink entries. Recorded, never followed. */
  linkTarget?: string;
}

export interface UnsafeEntry {
  path: string;
  reason: string;
}

export interface TarballContents {
  entries: TarEntry[];
  /** Entries we refused. Their bytes are discarded, never exposed. */
  rejected: UnsafeEntry[];
  fileCount: number;
  expandedBytes: number;
  /** True when a limit stopped us before reading the whole archive. */
  truncated: boolean;
}

export class TarballError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TarballError";
    this.code = code;
  }
}

/** Parse an octal ASCII field from a tar header block. */
function readOctal(buf: Buffer, offset: number, length: number): number {
  const field = buf.subarray(offset, offset + length);
  // GNU base-256 encoding for large values; otherwise classic octal.
  if (field[0] & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i++) {
      value = value * 256 + field[i];
    }
    return value;
  }
  const text = field.toString("ascii").replace(/\0.*$/, "").trim();
  if (!text) return 0;
  const parsed = parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readString(buf: Buffer, offset: number, length: number): string {
  return buf.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/, "");
}

/**
 * Validate an archive path.
 *
 * Returns null when safe, or a rejection reason. This is the path-traversal
 * and symlink-escape gate: `..`, absolute paths, drive letters, backslashes and
 * NUL bytes are all refused before the entry can be represented at all.
 */
export function validateEntryPath(raw: string): { path: string } | { reason: string } {
  if (raw.includes("\0")) return { reason: "path contains a NUL byte" };
  if (raw.length > TARBALL_LIMITS.maxPathLength) return { reason: "path too long" };
  if (raw.includes("\\")) return { reason: "path contains a backslash" };
  if (raw.startsWith("/")) return { reason: "absolute path" };
  if (/^[A-Za-z]:/.test(raw)) return { reason: "drive-letter path" };

  const parts = raw.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return { reason: "empty path" };
  if (parts.length > TARBALL_LIMITS.maxPathDepth) return { reason: "path too deep" };
  if (parts.some((p) => p === "..")) return { reason: "parent-directory traversal" };

  return { path: parts.join("/") };
}

function typeFlagToKind(flag: string): EntryKind {
  switch (flag) {
    case "0":
    case "\0":
    case "":
      return "file";
    case "5":
      return "directory";
    case "1":
      return "hardlink";
    case "2":
      return "symlink";
    default:
      return "other";
  }
}

/**
 * Parse a gzipped tar archive fully in memory.
 *
 * Throws `TarballError` for structural problems (bad magic, truncation).
 * Individual unsafe entries are collected into `rejected` rather than throwing,
 * so one bad file cannot hide the rest of the package's contents from analysis.
 */
export function readTarball(gzipped: Buffer): TarballContents {
  const startedAt = Date.now();

  if (gzipped.length < 3 || gzipped[0] !== GZIP_MAGIC[0] || gzipped[1] !== GZIP_MAGIC[1]) {
    throw new TarballError("DZ_TAR_NOT_GZIP", "Artifact is not a gzip stream; npm publishes gzipped tarballs.");
  }

  let tar: Buffer;
  try {
    // gunzipSync has its own maxOutputLength guard, which is the second line of
    // defence behind our own expanded-byte accounting.
    tar = gunzipSync(gzipped, { maxOutputLength: TARBALL_LIMITS.maxExpandedBytes });
  } catch (err) {
    throw new TarballError(
      "DZ_TAR_BAD_GZIP",
      `Tarball could not be decompressed: ${(err as Error).message}`,
    );
  }

  const entries: TarEntry[] = [];
  const rejected: UnsafeEntry[] = [];
  let expandedBytes = 0;
  let fileCount = 0;
  let truncated = false;
  let offset = 0;
  let emptyBlocks = 0;

  while (offset + BLOCK_SIZE <= tar.length) {
    if (Date.now() - startedAt > TARBALL_LIMITS.maxTimeMs) {
      truncated = true;
      break;
    }

    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    offset += BLOCK_SIZE;

    // Two consecutive zero blocks mark end-of-archive.
    if (header.every((b) => b === 0)) {
      emptyBlocks += 1;
      if (emptyBlocks >= 2) break;
      continue;
    }
    emptyBlocks = 0;

    // ustar magic check. Present at offset 257 for ustar, and GNU tar writes
    // "ustar  \0". We accept both plus a bare-zero legacy header.
    const magic = readString(header, 257, 6);
    if (magic !== "ustar") {
      // Tolerate pre-POSIX archives but reject genuinely malformed blocks.
      const checksumField = readOctal(header, 148, 8);
      if (checksumField === 0) {
        throw new TarballError("DZ_TAR_MALFORMED", "Archive contains a malformed header block.");
      }
    }

    const rawPath = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 0);
    const linkTargetRaw = readString(header, 157, 100);
    const prefix = readString(header, 345, 155);
    const fullRaw = prefix ? `${prefix}/${rawPath}` : rawPath;

    const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    const dataStart = offset;
    const dataEnd = dataStart + size;

    if (entries.length >= TARBALL_LIMITS.maxEntries) {
      truncated = true;
      break;
    }
    if (expandedBytes + size > TARBALL_LIMITS.maxExpandedBytes) {
      truncated = true;
      break;
    }
    if (size > TARBALL_LIMITS.maxEntryBytes) {
      rejected.push({ path: fullRaw || "(unnamed)", reason: "entry exceeds per-file size limit" });
      offset = dataStart + padded;
      continue;
    }
    if (dataEnd > tar.length) {
      throw new TarballError("DZ_TAR_TRUNCATED", "Archive is truncated: entry data exceeds the file length.");
    }

    const checked = validateEntryPath(fullRaw);
    if ("reason" in checked) {
      rejected.push({ path: fullRaw || "(unnamed)", reason: checked.reason });
      offset = dataStart + padded;
      continue;
    }

    const kind = typeFlagToKind(typeFlag);

    if (kind === "symlink" || kind === "hardlink") {
      // Recorded for the report, never followed, never materialised.
      entries.push({
        path: checked.path,
        kind,
        size: 0,
        linkTarget: linkTargetRaw,
      });
      fileCount += 1;
      offset = dataStart + padded;
      continue;
    }

    if (kind === "other") {
      rejected.push({
        path: checked.path,
        reason: `unsupported archive entry type "${typeFlag}" (device/fifo/socket)`,
      });
      offset = dataStart + padded;
      continue;
    }

    if (kind === "directory") {
      entries.push({ path: checked.path, kind, size: 0 });
      offset = dataStart + padded;
      continue;
    }

    entries.push({
      path: checked.path,
      kind: "file",
      size,
      bytes: tar.subarray(dataStart, dataEnd),
    });
    expandedBytes += size;
    fileCount += 1;
    offset = dataStart + padded;
  }

  return { entries, rejected, fileCount, expandedBytes, truncated };
}
