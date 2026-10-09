import { AppShell } from "@/components/app/AppShell";
import { getRpcStatus } from "@/lib/solana";
import { listNodes } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Console shell for /app, /scan and /network.
 *
 * Deliberately scoped to this route group so the landing page at `/` keeps its
 * own layout untouched.
 */
export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [rpc, nodes] = await Promise.all([getRpcStatus(), listNodes()]);

  return (
    <AppShell rpc={rpc} nodeCount={nodes.length}>{children}</AppShell>
  );
}
