"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle pointer parallax for the globe illustration.
 *
 * Writes two CSS custom properties on the element as the pointer moves, which
 * the stylesheet consumes. Transform-only, so nothing reflows and nothing
 * animates on the main thread beyond a style write.
 *
 * Scoped deliberately: no pointer, no touch device, or reduced motion requested
 * means the properties are never set and the globe stays a plain static image.
 */
export function GlobeParallax({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Coarse pointer covers touch, where a hover response has no meaning.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;

    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // Normalised -1..1 from the centre, then damped to a few pixels. The
        // illustration should feel like it has depth, not like it is tracking.
        const nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
        const ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

        node.style.setProperty("--globe-hover-x", `${(-nx * 6).toFixed(2)}px`);
        node.style.setProperty("--globe-hover-y", `${(-ny * 6).toFixed(2)}px`);
      });
    };

    const onLeave = () => {
      node.style.setProperty("--globe-hover-x", "0px");
      node.style.setProperty("--globe-hover-y", "0px");
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={ref} className="globe-stage relative mx-auto w-full max-w-[688px]">
      {children}
    </div>
  );
}