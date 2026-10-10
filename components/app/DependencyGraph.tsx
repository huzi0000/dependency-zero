"use client";

import { useState } from "react";
import { CheckCircle2, Maximize2, Minus, Plus, ShieldAlert } from "lucide-react";

export interface GraphNode {
  id: string;
  label: string;
  version: string;
  /** Only set once a scanner has actually judged the node. */
  verdict?: "blocked" | "review" | "allow";
}

function nodeTone(node: GraphNode): string {
  if (node.verdict === "blocked") return "border-[#E8B4AC] bg-[#FDF2F0] text-[#8A2C23]";
  if (node.verdict === "review") return "border-[#EBD3A4] bg-[#FDF7EA] text-[#6B440B]";
  if (node.verdict === "allow") return "border-[#B9D9C6] bg-[#F1F8F4] text-[#155534]";
  return "border-line-soft bg-white text-label";
}

/**
 * Dependency graph, built from HTML/SVG primitives.
 *
 * The root package is always real. Transitive dependencies appear only once a
 * scanner resolves them — with no scanner engine this renders the honest
 * single-node state instead of an invented attack graph.
 */
export function DependencyGraph({
  root,
  edges,
}: {
  root: GraphNode;
  edges: { from: string; to: GraphNode }[];
}) {
  const [zoom, setZoom] = useState(1);

  return (
    <section className="dz-card flex flex-col" aria-labelledby="dep-graph">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 id="dep-graph" className="text-[15px] font-bold text-ink">
          Dependency Graph
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
            aria-label="Zoom in"
            className="inline-flex size-7 items-center justify-center rounded-[6px] border border-line-soft bg-white text-label transition-colors hover:text-ink"
          >
            <Plus aria-hidden="true" strokeWidth={1.9} className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}
            aria-label="Zoom out"
            className="inline-flex size-7 items-center justify-center rounded-[6px] border border-line-soft bg-white text-label transition-colors hover:text-ink"
          >
            <Minus aria-hidden="true" strokeWidth={1.9} className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            className="inline-flex size-7 items-center justify-center rounded-[6px] border border-line-soft bg-white text-label transition-colors hover:text-ink"
          >
            <Maximize2 aria-hidden="true" strokeWidth={1.9} className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="dz-scroll overflow-x-auto px-4 pb-4">
        <div
          className="flex min-h-[132px] items-center gap-3"
          style={{ transform: `scale(${zoom})`, transformOrigin: "left center" }}
        >
          <div
            className={`flex min-w-[128px] items-center gap-2 rounded-[7px] border px-2.5 py-2 ${
              root.verdict ? nodeTone(root) : "border-line bg-white text-ink"
            }`}
          >
            <ShieldAlert
              aria-hidden="true"
              strokeWidth={1.8}
              className={`size-4 shrink-0 ${root.verdict === "blocked" ? "text-[#D94A3D]" : "text-label"}`}
            />
            <span className="mono-body min-w-0 text-[11.5px] leading-tight">
              <span className="block truncate font-semibold">{root.label}</span>
              <span className="block truncate opacity-80">{root.version}</span>
            </span>
          </div>

          {edges.length === 0 ? (
            <p className="mono-body max-w-[38ch] text-[11.5px] leading-[1.6] text-label">
              Transitive dependencies appear once a scanner resolves this package.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {edges.map((edge) => (
                <div key={edge.to.id} className="flex items-center gap-3">
                  <span aria-hidden="true" className="h-px w-6 bg-line" />
                  <div
                    className={`flex min-w-[128px] items-center gap-2 rounded-[7px] border px-2.5 py-2 ${nodeTone(edge.to)}`}
                  >
                    <CheckCircle2 aria-hidden="true" strokeWidth={1.8} className="size-4 shrink-0" />
                    <span className="mono-body min-w-0 text-[11.5px] leading-tight">
                      <span className="block truncate font-semibold">{edge.to.label}</span>
                      <span className="block truncate opacity-80">{edge.to.version}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
