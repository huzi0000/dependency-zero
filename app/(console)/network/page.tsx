import { NetworkView } from "@/components/app/NetworkView";
import { collectAttestations, type NetworkData } from "@/lib/network";
import { getRpcStatus } from "@/lib/solana";
import { listNodes, listScans } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const [nodes, rpc, scans] = await Promise.all([
    listNodes(),
    getRpcStatus(),
    listScans(1000),
  ]);

  const data: NetworkData = {
    nodes,
    rpc,
    attestations: collectAttestations(scans),
    // Only scans a scanner actually resolved carry a consensus event.
    resolved: scans.filter((s) => s.status !== "pending" && s.status !== "error"),
  };

  return <NetworkView data={data} />;
}
