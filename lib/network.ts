import type { RpcStatus, ScanRecord, ScannerNode } from "@/lib/types";

/**
 * An on-chain attestation derived from a scan that carries a real signature.
 *
 * A signature only ever originates from a recorded transaction, so this shape
 * cannot exist without one — nothing here is synthesised.
 */
export interface AttestationRow {
  id: string;
  packageName: string;
  version: string;
  verdict: string;
  signature: string;
  createdAt: string;
}

/** Extract real attestations from stored scans. Never fabricates a signature. */
export function collectAttestations(scans: ScanRecord[]): AttestationRow[] {
  return scans
    .filter((s) => Boolean(s.attestationSignature) && s.status !== "pending" && s.status !== "error")
    .map((s) => ({
      id: s.id,
      packageName: s.packageName,
      version: s.version,
      verdict: s.status,
      signature: s.attestationSignature as string,
      createdAt: s.createdAt,
    }));
}

/** Registered scanner identities. Zero is the honest answer on a fresh deploy. */
export function activeNodes(nodes: ScannerNode[]): number {
  return nodes.filter((n) => Boolean(n.identity)).length;
}

/** Everything the Network page renders, prepared for the client boundary. */
export interface NetworkData {
  nodes: ScannerNode[];
  rpc: RpcStatus;
  attestations: AttestationRow[];
  /** Scans a scanner node has actually resolved. */
  resolved: ScanRecord[];
}
