"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared behaviour for the two horizontal tab bars (`PageTabs` on the Scanner
 * and Threat Report, `SegmentedTabs` on Network).
 *
 * Two real defects motivated this:
 *
 * 1. **No scroll affordance.** The underline bar set `scrollbar-width: none`
 *    and `::-webkit-scrollbar { display: none }`. With five tabs on a 360px
 *    phone the row is ~570px wide, so "On-chain Proof" sat off-screen with
 *    nothing indicating the row could move. It read as a clipped tab.
 *    `canScrollLeft` / `canScrollRight` let the caller show an honest cue, and
 *    the scrollbar itself is now visible (see `.dz-tabs` in globals.css).
 *
 * 2. **Arrow keys did nothing.** Both bars render `role="tablist"` with
 *    `role="tab"` children, which obliges the author to implement
 *    ArrowLeft/ArrowRight/Home/End and a roving tabindex. Neither did. The
 *    old comments claimed native buttons handled it; they do not. A keyboard
 *    user could Tab to the selected tab and then had no way to reach the
 *    others. This returns the handler that closes that gap.
 *
 * Roving tabindex: exactly one tab is tabbable (the selected one). Arrow keys
 * move both the selection and DOM focus, which is what the ARIA authoring
 * practices prescribe for an automatic-activation tablist.
 */
export interface TabBarBehaviour {
  /** Ref for the scrolling row. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Ref callback for each tab button, keyed by tab id. */
  register: (id: string) => (el: HTMLButtonElement | null) => void;
  /** `onKeyDown` for each tab button. */
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => void;
  /** Whether there is content hidden to the left. */
  canScrollLeft: boolean;
  /** Whether there is content hidden to the right. */
  canScrollRight: boolean;
  /** Re-measure after layout or content changes. */
  refresh: () => void;
}

export function useTabBar<T extends string>(
  tabs: { id: T; disabled?: boolean }[],
  value: T,
  onChange: (id: T) => void,
): TabBarBehaviour {
  const ref = useRef<HTMLDivElement | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    /* A 1px tolerance: fractional device widths make scrollWidth land a
       fraction over clientWidth even when nothing is actually hidden, which
       would otherwise light the affordance permanently. */
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < max - 1,
    });
  }, []);

  const register = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) buttons.current.set(id, el);
      else buttons.current.delete(id);
    },
    [],
  );

  const focusTab = useCallback((id: T) => {
    const el = buttons.current.get(id);
    el?.focus();
    /* `nearest` keeps a one-line tab bar from jumping when it already fits,
       but still pulls a far-off tab into view. `block: "nearest"` avoids
       vertically scrolling the page when the user is reading further down. */
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, []);

  const step = useCallback(
    (from: T, delta: number): T | null => {
      const order = tabs.map((t) => t.id);
      const enabled = order.filter((id) => {
        const t = tabs.find((x) => x.id === id);
        return !t?.disabled;
      });
      if (enabled.length === 0) return null;
      const i = enabled.indexOf(from);
      const next = enabled[((i < 0 ? 0 : i) + delta + enabled.length) % enabled.length];
      return next ?? null;
    },
    [tabs],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, id: T) => {
      let target: T | null = null;
      switch (event.key) {
        case "ArrowRight":
          target = step(id, 1);
          break;
        case "ArrowLeft":
          target = step(id, -1);
          break;
        case "Home":
          target = tabs.find((t) => !t.disabled)?.id ?? null;
          break;
        case "End": {
          const list = tabs.filter((t) => !t.disabled);
          target = list.length ? list[list.length - 1].id : null;
          break;
        }
        default:
          return;
      }
      if (!target) return;
      event.preventDefault();
      onChange(target);
      focusTab(target);
    },
    [focusTab, onChange, step, tabs],
  );

  /* Pull the selected tab into view whenever the selection changes, including
     the initial render — otherwise a bar that loads on a non-default tab (or
     re-renders after a resize) can leave the active tab off-screen. */
  useEffect(() => {
    const el = buttons.current.get(value);
    if (!el) return;
    const row = ref.current;
    if (!row) return;
    const er = el.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (er.left < rr.left || er.right > rr.right) {
      el.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
    measure();
    /* `value` alone is intentional: re-running on every render would fight the
       user's own scrolling. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /* Edge state has to react to resize, font load and badge-count changes. */
  useEffect(() => {
    /* Defer to the next frame so the initial layout (gap, flex, badge width)
       has settled; otherwise scrollWidth can read 0 on the first paint. */
    const raf = requestAnimationFrame(measure);
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, tabs.length]);

  const refresh = useCallback(() => measure(), [measure]);

  return {
    ref,
    register,
    onKeyDown: onKeyDown as TabBarBehaviour["onKeyDown"],
    canScrollLeft: edges.left,
    canScrollRight: edges.right,
    refresh,
  };
}