/**
 * Structural types for the browser wallet APIs Dependency Zero speaks.
 *
 * Two standards are supported deliberately:
 *
 * 1. **Wallet Standard** (`navigator.wallets`) — the current spec. Phantom,
 *    Backpack and Xverse register here.
 * 2. **Legacy injected providers** (`window.phantom.solana`, `window.solana`,
 *    `window.backpack`, `window.keplr`) — still the only path some extensions
 *    expose, and the most battle-tested path for Phantom specifically.
 *
 * Supporting only Wallet Standard made the control permanently unusable for
 * anyone whose extension had not registered with the standard API, so both are
 * normalised into one shape by `lib/wallet-providers.ts`.
 *
 * No type here ever carries key material: only public addresses are read.
 */

export interface WalletAccountLike {
  address: string;
  label?: string | null;
  publicKey?: Uint8Array | null;
}

/** Wallet Standard `chains` feature, when a wallet advertises its networks. */
export interface ChainsFeature {
  readonly?: "chains";
  supported: string[];
}

export interface WalletStandardWallet {
  name: string;
  icon?: string;
  rdns?: string;
  version?: string;
  accounts: WalletAccountLike[];
  features: {
    standard?: { readonly?: "standard" };
    connect?: {
      readonly?: "connect";
      connect: () => Promise<{ accounts: WalletAccountLike[] }>;
      on?: (event: "change", handler: () => void) => void;
      off?: (event: "change", handler: () => void) => void;
    };
    disconnect?: { readonly?: "disconnect"; disconnect: () => Promise<void> };
    /** Disconnect without a preceding connect. Common on Wallet Standard. */
    "connect:disconnect"?: {
      readonly?: "connect:disconnect";
      connect: () => Promise<{ accounts: WalletAccountLike[] }>;
      disconnect: () => Promise<void>;
      on?: (event: "change", handler: () => void) => void;
      off?: (event: "change", handler: () => void) => void;
    };
    chains?: ChainsFeature;
  };
}

export interface WalletsRegistry {
  get(): Promise<WalletStandardWallet[]>;
  register(callback: (wallet: WalletStandardWallet) => void): () => void;
}

/** Legacy `window.phantom.solana`-style provider. */
export interface LegacySolanaProvider {
  isPhantom?: boolean;
  publicKey?: string | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: string } | string>;
  disconnect(): Promise<void>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface LegacyHost {
  solana?: LegacySolanaProvider;
  isPhantom?: boolean;
  connect?(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: string }>;
  disconnect?(): Promise<void>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Navigator {
    wallets?: WalletsRegistry;
  }
  interface Window {
    phantom?: LegacyHost;
    solana?: LegacySolanaProvider;
    backpack?: LegacyHost;
    keplr?: LegacyHost;
    xverse?: LegacyHost;
  }
}
