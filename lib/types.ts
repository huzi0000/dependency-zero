/** Shared domain types for the Dependency Zero Dashboard. */

import type { ScanResolution } from "@/lib/scanner/types";

export type Verdict = "allow" | "review" | "block";

/**
 * Lifecycle of a scan. `pending` is the honest default: a scan is only
 * resolved once a registered scanner node reports a verdict.
 *
 * NOTE: `status` is a superset carrying BOTH lifecycle and verdict, because the
 * existing console renders it directly. The authoritative lifecycle lives in
 * `phase`; the authoritative security opinion lives in `verdict`.
 */
export type ScanStatus = "pending" | "allow" | "review" | "block" | "error";

export type TimeRange = "24H" | "7D" | "30D" | "ALL";

export const TIME_RANGES: TimeRange[] = ["24H", "7D", "30D", "ALL"];

export interface ScanRecord {
  id: string;
  /** npm coordinates, e.g. "express@4.18.2". */
  packageName: string;
  version: string;
  status: ScanStatus;
  /**
   * True lifecycle. Absent on records written before the real scanner existed;
   * those are legacy pending records and are displayed honestly as such.
   */
  phase?: "queued" | "scanning" | "completed" | "error";
  /** Authoritative security verdict. Null while unknown. */
  verdict?: Verdict | null;
  riskScore?: number | null;
  scannerVersion?: string;
  policyVersion?: string;
  /** Full structured result, present only for genuinely completed scans. */
  resolution?: ScanResolution;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Public key of the scanner node that produced the verdict, when known. */
  resolvedBy: string | null;
  /** Number of nodes that voted on this scan. */
  votes: number;
  /** On-chain attestation signature. Only ever set from a real transaction. */
  attestationSignature: string | null;
  /** Findings recorded by the scanning engine. Empty until a node responds. */
  findings: ScanFinding[];
  error: string | null;
}

export interface ScanFinding {
  rule: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  detail: string;
}

export interface ScannerNode {
  id: string;
  name: string;
  /** Base58 public key of the node identity. */
  identity: string;
  endpoint: string;
  registeredAt: string;
  lastSeenAt: string | null;
  /** Populated only from a real geo lookup of the node's IP. */
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  scansCompleted: number;
}

/** Derived, never stored. */
export interface Metrics {
  range: TimeRange;
  dependenciesScanned: number;
  threatsBlocked: number;
  activeNodes: number;
  /** null when there is not enough data to defend a number. */
  networkAccuracy: number | null;
  networkAccuracySamples: number;
  previous: {
    dependenciesScanned: number;
    threatsBlocked: number;
    activeNodes: number;
  } | null;
  series: { dependenciesScanned: number; threatsBlocked: number }[];
  /**
   * Axis labels for the activity chart, computed on the server so the client
   * never re-derives them from its own clock (which would hydrate differently).
   */
  bucketLabels: string[];
  /** ISO timestamp of each bucket's start, for tooltips. */
  bucketStarts: string[];
}

export interface RpcStatus {
  reachable: boolean;
  cluster: string;
  endpoint: string;
  version: string | null;
  slot: number | null;
  latencyMs: number | null;
  checkedAt: string;
  error: string | null;
}

export function packageCoordinates(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * Percentage change between two periods, or null when there is no defensible
 * baseline. A zero (or absent) prior period yields null rather than a
 * fabricated "+100%" or "-0%".
 */
export function percentChange(
  current: number,
  previous: number | undefined,
): number | null {
  if (previous === undefined || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
