import Image from "next/image";
import Link from "next/link";

import type { ScannerNode } from "@/lib/types";

/**
 * Decorative world map.
 *
 * The green dots baked into the asset are part of the artwork and are NOT
 * scanner locations. Real node markers are only drawn when a node carries
 * verified geo metadata; otherwise the panel is labelled illustrative.
 */
export function NetworkOverview({ nodes }: { nodes: ScannerNode[] }) {
  const located = nodes.filter(
    (n) => typeof n.latitude === "number" && typeof n.longitude === "number",
  );

  return (
    <section className="dz-card flex h-full flex-col p-4" aria-labelledby="network-overview-heading">
      <h2 id="network-overview-heading" className="font-sans text-[15px] font-bold text-ink">
        Network Overview
      </h2>
      <p className="mt-1 text-[12.5px] text-label">
        Local scanner roles securing the dependency supply chain
        ecosystem.
      </p>

      <div className="relative mt-3 flex-1 overflow-hidden rounded-[6px]">
        <Image
          src="/Dotted World Map with Green Data Points.png"
          alt="Stylised dotted world map used as an illustrative backdrop for the scanner network"
          width={1920}
          height={819}
          priority
          className="h-full w-full object-contain opacity-80"
        />

        {located.length > 0 ? (
          <ul aria-label="Registered scanner locations" className="absolute inset-0">
            {located.map((node) => (
              <li
                key={node.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${((node.longitude as number) + 180) / 360 * 100}%`,
                  top: `${((90 - (node.latitude as number)) / 180) * 100}%`,
                }}
              >
                <span
                  title={`${node.name}${node.city ? ` — ${node.city}` : ""}`}
                  className="block size-2.5 rounded-full border-2 border-[#F1EFE8] bg-safe"
                />
                <span className="sr-only">
                  {node.name}
                  {node.city ? ` in ${node.city}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="mono-body mt-2.5 text-[11px] leading-[1.5] text-label">
        {located.length > 0
          ? "Markers show registered scanner nodes with verified location data."
          : "Illustrative map — marker placement is decorative, not real node geography."}
      </p>

      <Link
        href="/network"
        className="dz-tap mt-3 inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-ink underline-offset-4 hover:underline"
      >
        View scanner network
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
