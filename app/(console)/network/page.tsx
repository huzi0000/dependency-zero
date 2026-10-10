import { NetworkView } from "@/components/app/NetworkView";
import {
  collectAttestations,
  collectConsensusEvents,
  collectScannerIdentities,
  type NetworkData,
} from "@/lib/network";
import { getRpcStatus } from "@/lib/solana";
import { listAttestations, listNodes, listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const [nodes, rpc, scans, stored] = await Promise.all([
    listNodes(),
    getRpcStatus(),
    listScans(1000),
    listAttestations(500),
  ]);

  const data: NetworkData = {
    nodes,
    rpc,
    attestations: await collectAttestations(scans),
    // Only scans a scanner actually resolved carry a consensus event.
    resolved: scans.filter((s) => s.status !== "pending" && s.status !== "error"),
    votes: collectConsensusEvents(
      scans,
      stored.map((s) => s.consensus),
    ),
    identities: collectScannerIdentities(stored),
    consensusPolicyVersion: stored[0]?.consensus.policyVersion ?? "n/a",
    // Truthful: no on-chain registry program exists in this deployment.
    onChainRegistryProgramDeployed: false,
  };

  return <NetworkView data={data} />;
}