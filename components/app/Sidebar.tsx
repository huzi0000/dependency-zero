"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Network as NetworkIcon, ScanLine } from "lucide-react";

import type { RpcStatus } from "@/lib/types";

const NAV = [
  { label: "Dashboard", href: "/app", icon: LayoutGrid },
  { label: "Scan", href: "/scan", icon: ScanLine },
  { label: "Network", href: "/network", icon: NetworkIcon },
];

/** Only the three real routes. Threat reports live at /scan/[id]. */
export function Sidebar({
  rpc,
  nodeCount,
  onNavigate,
}: {
  rpc: RpcStatus | null;
  nodeCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const online = rpc?.reachable === true;

  return (
    <div className="dz-sidebar flex h-full w-full flex-col">
      <Link
        href="/app"
        onClick={onNavigate}
        aria-label="Dependency Zero dashboard"
        className="flex items-center gap-3 px-5 pt-5 pb-6"
      >
        <Image
          src="/brand/logo-trimmed.png"
          alt=""
          width={2010}
          height={349}
          priority
          className="h-9 w-auto shrink-0"
        />
      </Link>

      <nav aria-label="Dashboard" className="flex flex-col gap-1 px-4">
        {NAV.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className="dz-nav-link"
            >
              <Icon aria-hidden="true" strokeWidth={1.7} className="size-[19px] shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-4">
        <div className="rounded-[8px] border border-line-soft bg-[#FFFFFF] p-3.5">
          <p className="text-[13px] font-semibold text-ink">Network Status</p>
          <div className="mt-2.5 flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-[7px] rounded-full ${
                online ? "bg-lime-deep" : "bg-[#C9C6BC]"
              }`}
            />
            <p className="text-[13px] text-ink-soft">Solana Devnet</p>
          </div>
          <p className="mono-body mt-1.5 text-[11.5px] text-label">
            {rpc === null
              ? "Checking…"
              : online
                ? nodeCount > 0
                  ? `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"} registered`
                  : "0 scanner nodes registered"
                : "RPC unreachable"}
          </p>
        </div>
      </div>
    </div>
  );
}
