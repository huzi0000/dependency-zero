/**
 * Client-safe Solana display helpers.
 *
 * These live apart from `lib/config.ts` on purpose. `lib/config.ts` computes
 * `DATA_DIR` from `node:os` at module scope, and two "use client" components
 * imported `explorerTxUrl` from it — which shipped `node:os`, the homedir logic
 * and the data-path resolution into the browser bundle, where it does nothing.
 *
 * Nothing here touches the filesystem or any secret. If a client component needs
 * an Explorer link, import it from here.
 */

/**
 * The Solana cluster this product targets.
 *
 * Devnet only, and deliberately not configurable: the whole trust model, the
 * proof bundles and the verifier's expectations are written against Devnet.
 * Allowing an arbitrary cluster here would let a link silently point at a
 * different network than the one the evidence was anchored on.
 */
export const EXPLORER_CLUSTER = "devnet";

/** Solana Explorer cluster slug used to build transaction links. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${EXPLORER_CLUSTER}`;
}

/** Solana Explorer link for a wallet address. */
export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${EXPLORER_CLUSTER}`;
}