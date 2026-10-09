"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { Sidebar } from "@/components/app/Sidebar";
import { Topbar } from "@/components/app/Topbar";
import { WalletRequirementProvider } from "@/components/app/WalletRequirement";
import { useWallet } from "@/components/app/useWallet";
import type { RpcStatus } from "@/lib/types";

const WIDTH = 240;

/**
 * Console shell: persistent sidebar on desktop, off-canvas drawer on mobile.
 *
 * Owns the single `useWallet` instance so wallet discovery runs once, then
 * publishes it through `WalletRequirementProvider` so any user-initiated action
 * can consult the mandatory-wallet gate. Background scanner ingestion is
 * unaffected — it is a server path with its own node identity.
 */
function ShellInner({
  rpc,
  nodeCount,
  children,
}: {
  rpc: RpcStatus | null;
  nodeCount: number;
  children: ReactNode;
}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <WalletRequirementProvider value={wallet}>
      <div className="dz-shell">
        {/* Desktop sidebar */}
        <aside
          className="fixed inset-y-0 left-0 z-40 hidden lg:block"
          style={{ width: WIDTH }}
        >
          <Sidebar rpc={rpc} nodeCount={nodeCount} />
        </aside>

        {/* Mobile drawer */}
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-[rgba(23,24,22,0.35)]"
            />
            <div
              id="console-nav"
              className="absolute inset-y-0 left-0 w-[264px] max-w-[86vw] shadow-[0_0_40px_rgba(23,24,22,0.2)]"
            >
              <Sidebar
                rpc={rpc}
                nodeCount={nodeCount}
                onNavigate={() => setOpen(false)}
              />
            </div>
          </div>
        ) : null}

        <div className="lg:pl-[240px]">
          <div className="sticky top-0 z-30 flex items-center">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="console-nav"
              className="ml-3 inline-flex size-10 items-center justify-center rounded-[8px] border border-line-soft bg-white text-ink lg:hidden"
            >
              {open ? (
                <X aria-hidden="true" strokeWidth={1.8} className="size-5" />
              ) : (
                <Menu aria-hidden="true" strokeWidth={1.8} className="size-5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <Topbar />
            </div>
          </div>

          <main id="main" className="px-4 py-6 md:px-6 md:py-7">
            {children}
          </main>
        </div>
      </div>
    </WalletRequirementProvider>
  );
}

export function AppShell({
  rpc,
  nodeCount,
  children,
}: {
  rpc: RpcStatus | null;
  nodeCount: number;
  children: ReactNode;
}) {
  return (
    <ShellInner rpc={rpc} nodeCount={nodeCount}>
      {children}
    </ShellInner>
  );
}
