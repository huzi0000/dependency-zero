import "server-only";

import { EXPLORER_CLUSTER, rpcEndpoint } from "@/lib/config";
import type { RpcStatus } from "@/lib/types";

/**
 * Minimal Solana JSON-RPC client.
 *
 * Uses the public Devnet endpoint by default so the project runs with zero
 * configuration. Set SOLANA_RPC_URL to point at a dedicated provider (e.g.
 * Helius) if you need higher rate limits. No key material is ever involved —
 * this is a read-only client.
 */

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) throw new Error(payload.error.message ?? `RPC ${method} errored`);
  return payload.result as T;
}

/** Live Devnet health. Used for the sidebar status indicator. */
export async function getRpcStatus(): Promise<RpcStatus> {
  const endpoint = rpcEndpoint();
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const [health, version] = await Promise.all([
      rpc<string>("getHealth"),
      rpc<{ "solana-core": string; "feature-set": number } | string>("getVersion"),
    ]);
    if (health !== "ok") throw new Error(`cluster reported "${health}"`);

    const core =
      typeof version === "string" ? version : (version?.["solana-core"] ?? null);

    return {
      reachable: true,
      cluster: EXPLORER_CLUSTER,
      endpoint,
      version: core,
      slot: null,
      latencyMs: Date.now() - started,
      checkedAt,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      cluster: EXPLORER_CLUSTER,
      endpoint,
      version: null,
      slot: null,
      latencyMs: null,
      checkedAt,
      error: error instanceof Error ? error.message : "RPC unreachable",
    };
  }
}

/**
 * Verifies a connected wallet really exists on chain by reading its balance.
 * A wallet with zero balance is still valid, so the check is presence-based.
 */
export async function verifyWallet(address: string): Promise<{
  ok: boolean;
  lamports: number | null;
  error: string | null;
}> {
  try {
    const res = await rpc<{ value: number }>("getBalance", [address]);
    return { ok: true, lamports: res.value, error: null };
  } catch (error) {
    return {
      ok: false,
      lamports: null,
      error: error instanceof Error ? error.message : "lookup failed",
    };
  }
}
