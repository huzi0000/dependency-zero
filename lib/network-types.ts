import type { RpcStatus, ScanRecord, ScannerNode } from "@/lib/types";

/**
 * Client-safe shapes for the Network page.
 *
 * This module is deliberately free of any server import. `lib/network.ts`
 * reaches the scan store (and therefore `node:fs`), and the Network view is a
 * client component: keeping the types here stops the filesystem being pulled
 * into the browser module graph.
 *
 * Every shape below mirrors what actually happened. Nothing is invented to
 * fill a gap.
 */

/** An attestation row, with the real chain outcome attached. */
export interface AttestationRow {
  id: string;
  packageName: string;
  version: string;
  /** Consensus result: allow | review | block. */
  verdict: string;
  /** Real transaction signature, or null when nothing was anchored. */
  signature: string | null;
  createdAt: string;
  /** Mechanism label, always exact: Memo is never called a program. */
  mechanism: string;
  status: string;
  slot: number | null;
  commitmentHash: string;
  /** The honest reason anchoring did not complete, when applicable. */
  reason: string | null;
}

/** A scanner identity as actually configured on this host. */
export interface ScannerIdentityRow {
  publicKeyHex: string;
  role: string;
  registeredAt: string;
  registryVersion: number;
  revoked: boolean;
  operator: string;
  /** True only when a registry commitment for this identity was anchored. */
  onChainRegistered: boolean;
}

/** One scanner's real vote on one scan. */
export interface ConsensusVoteRow {
  scanId: string;
  packageName: string;
  role: string;
  verdict: string;
  publicKeyHex: string;
  operator: string;
}

/** Everything the Network page renders, prepared for the client boundary. */
export interface NetworkData {
  nodes: ScannerNode[];
  rpc: RpcStatus;
  attestations: AttestationRow[];
  /** Scans a scanner node has actually resolved. */
  resolved: ScanRecord[];
  /** Real per-scanner votes across attested scans. */
  votes: ConsensusVoteRow[];
  /** Locally configured scanner identities, with honest on-chain status. */
  identities: ScannerIdentityRow[];
  /** Consensus policy version actually in force. */
  consensusPolicyVersion: string;
  /**
   * False in this deployment, and the UI must keep saying so. No Rust, cargo,
   * solana CLI or Anchor is available here, so no on-chain registry program
   * could be built or deployed. The registry is local, anchored by commitment.
   */
  onChainRegistryProgramDeployed: boolean;
}

/** Registered scanner identities. Zero is the honest answer on a fresh deploy. */
export function activeNodes(nodes: ScannerNode[]): number {
  return nodes.filter((n) => Boolean(n.identity)).length;
}