import "server-only";

import { listAttestations, type StoredAttestation } from "@/lib/store-core";
import type { ConsensusResult } from "@/lib/attest/consensus";
import type { ScanRecord } from "@/lib/types";
import type {
  AttestationRow,
  ConsensusVoteRow,
  ScannerIdentityRow,
} from "@/lib/network-types";

/**
 * Network-page collectors, server side.
 *
 * The single rule here: a row exists only when a real record exists. An
 * attestation row requires a real stored attestation; a vote requires a real
 * consensus vote. Nothing is synthesised, and the absence of a deployed
 * on-chain registry program is stated rather than implied away.
 *
 * Types live in `lib/network-types.ts` so client components can use them
 * without dragging this module's filesystem access into the browser bundle.
 */

export type {
  AttestationRow,
  ConsensusVoteRow,
  NetworkData,
  ScannerIdentityRow,
} from "@/lib/network-types";
export { activeNodes } from "@/lib/network-types";

function toRow(stored: StoredAttestation, scanLookup: Map<string, ScanRecord>): AttestationRow {
  const scan = scanLookup.get(stored.scanId);
  return {
    id: stored.scanId,
    packageName: stored.bundle.scan.name,
    version: stored.bundle.scan.version,
    verdict: stored.consensus.result,
    signature: stored.attestation.transactionSignature,
    createdAt: scan?.createdAt ?? stored.updatedAt,
    mechanism: stored.attestation.mechanismLabel,
    status: stored.attestation.confirmed ? "confirmed" : stored.attestation.status,
    slot: stored.attestation.slot,
    commitmentHash: stored.bundle.commitment,
    reason: stored.attestation.error,
  };
}

/** Real attestations from the attestation store. Never fabricates a signature. */
export async function collectAttestations(scans: ScanRecord[]): Promise<AttestationRow[]> {
  const stored = await listAttestations(500);
  const lookup = new Map(scans.map((s) => [s.id, s]));
  return stored.map((s) => toRow(s, lookup));
}

/**
 * Real votes across every scan that produced consensus.
 *
 * A scan with no attestation contributes nothing, which is why historical scans
 * legitimately appear with no votes at all.
 */
export function collectConsensusEvents(
  scans: ScanRecord[],
  consensus: ConsensusResult[],
): ConsensusVoteRow[] {
  const rows: ConsensusVoteRow[] = [];
  consensus.forEach((c, i) => {
    const scan = scans[i];
    if (!scan) return;
    for (const v of c.votes) {
      rows.push({
        scanId: scan.id,
        packageName: `${scan.packageName}@${scan.version}`,
        role: v.role,
        verdict: v.verdict,
        publicKeyHex: v.publicKeyHex,
        operator: v.operator,
      });
    }
  });
  return rows;
}

/**
 * Scanner identities configured on this host.
 *
 * `onChainRegistered` is false for all of them, permanently, in this
 * deployment: no on-chain registry program exists. The registry is local and
 * anchored by commitment only, and the UI says exactly that.
 */
export function collectScannerIdentities(stored: StoredAttestation[]): ScannerIdentityRow[] {
  const entries = stored[0]?.bundle.registry.entries ?? [];
  return entries.map((e) => ({
    publicKeyHex: e.publicKeyHex,
    role: e.role,
    registeredAt: e.registeredAt,
    registryVersion: e.registryVersion,
    revoked: e.revoked,
    operator: e.operator,
    onChainRegistered: false,
  }));
}