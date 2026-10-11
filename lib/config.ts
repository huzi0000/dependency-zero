import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runtime configuration.
 *
 * Every value is optional so the Dashboard boots with zero configuration and
 * degrades to honest "not connected" states instead of failing.
 */

export const SOLANA_CLUSTER = "devnet" as const;

const DEFAULT_RPC: Record<typeof SOLANA_CLUSTER, string> = {
  devnet: "https://api.devnet.solana.com",
};

export function rpcEndpoint(): string {
  const fromEnv = process.env.SOLANA_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_RPC[SOLANA_CLUSTER];
}

/**
 * Solana Explorer cluster slug used to build transaction links.
 *
 * The implementation lives in `lib/explorer.ts` so client components can build
 * links without importing this module — which resolves `DATA_DIR` from
 * `node:os` at module scope and therefore does not belong in a browser bundle.
 * Re-exported here so server code keeps one import site.
 */
export { EXPLORER_CLUSTER, explorerTxUrl, explorerAddressUrl } from "./explorer.ts";

/**
 * Where the file-backed scan store lives. Swap the repository in `lib/store.ts`
 * for a real database when one is available; nothing else needs to change.
 *
 * The default is the OS application-data directory, deliberately OUTSIDE the
 * project tree. Next's dev server watches the project directory, so a store
 * kept here would trigger a full recompile on every scan write — stalling
 * navigation and API reads. Override with DZ_DATA_DIR when deploying.
 */
function defaultDataDir(): string {
  if (process.env.DZ_DATA_DIR?.trim()) return process.env.DZ_DATA_DIR.trim();
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? tmpdir(), "dependency-zero", "data");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "dependency-zero");
  }
  return join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "dependency-zero",
  );
}

export const DATA_DIR = defaultDataDir();
