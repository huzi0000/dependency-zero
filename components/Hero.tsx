"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { ActionLink } from "@/components/ui/Button";
import { TagCallout } from "@/components/ui/Callout";

/**
 * Static capability statements, not live statistics.
 *
 * These were previously invented counters (1.2M scans, 18.4K threats, 420
 * nodes, 99.7% accuracy). None was backed by a record, so they are replaced by
 * statements of what the product actually does, with the illustrative-value
 * disclosure rendered beneath. Real per-deployment counts live in the console
 * dashboard, computed from the scan store.
 *
 * They were then reworded again: the bare tokens `npm / OSV / Ed25519 /
 * Devnet` were implementation names, not user-facing explanations, and read
 * as jargon to anyone who had not already met the product. Each entry now
 * leads with a plain-language benefit and keeps the implementation name as
 * secondary detail underneath, so the technical vocabulary is still present
 * but no longer carries the message.
 */
const HERO_CAPABILITIES = [
  {
    n: "01",
    title: "Package security",
    detail: "Scan packages before installing.",
    tech: "npm registry + published tarball",
  },
  {
    n: "02",
    title: "Known vulnerabilities",
    detail: "Check published security advisories.",
    tech: "OSV advisory data",
  },
  {
    n: "03",
    title: "Signed evidence",
    detail: "Digitally signed scan findings.",
    tech: "Ed25519, three local roles",
  },
  {
    n: "04",
    title: "Solana proof",
    detail: "Optional on-chain verification.",
    tech: "Devnet — never required to scan",
  },
];

const HERO_STAGES = [
  {
    label: "Scan",
    detail: "Inspect metadata, tarball and advisories.",
  },
  {
    label: "Decide",
    detail: "Three signed local roles, one deterministic verdict.",
  },
  {
    label: "Protect",
    detail: "Enforce before npm runs; prove with a bundle.",
  },
];

export function Hero() {
  /**
   * Respect the OS reduce-motion preference.
   *
   * `prefers-reduced-motion` in CSS cannot pause an HTML <video>: it only
   * overrides `animation-*` and `transition-*` properties. The hero loop
   * therefore kept playing for users who asked for reduced motion. The poster
   * frame is shown instead.
   *
   * Starts as `true` so the server and first client render agree — a reduced
   * video element and a `<img>` poster are different markup, and guessing
   * during SSR would produce a hydration mismatch.
   */
  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotionAllowed(!query.matches);

    const onChange = (e: MediaQueryListEvent) => setMotionAllowed(!e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <section className="page-shell pt-5 lg:pt-8" aria-labelledby="hero-heading">
      {/* The copy column is deliberately given a touch more than half the
          split. At 0.92fr the measured column fell to ~444px on a 1024px
          viewport while the metric band inside it was pinned at a fixed
          748px, so the band painted over the artwork (the column carries
          z-10). Sizing the column from the content instead of a fixed width
          is what removes the overlap; the ratio is only enough to keep
          "TRUST." from wrapping at intermediate widths. */}
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-y-12">
        {/* ---------------------------------------------------------------- */}
        {/* Copy column                                                      */}
        {/* ---------------------------------------------------------------- */}
        <div className="relative z-10">
          <p className="eyebrow">Security layer for autonomous agents</p>

          <h1 id="hero-heading" className="mt-6 lg:mt-7">
            <span className="block font-sans text-[clamp(3rem,8.4vw,8rem)] font-bold leading-[0.86] tracking-[-0.035em] text-ink">
              ZERO
              <br />
              TRUST.
            </span>
            <span className="mt-1 block font-serif text-[clamp(1.85rem,5.4vw,5.1rem)] italic leading-[1.05] tracking-[-0.01em] text-ink">
              Before Execution.
            </span>
          </h1>

          <p className="mono-body mt-7 max-w-[34ch] text-[17px] leading-[1.62] text-ink-soft">
            Dependency security for AI agents. Signed evidence, optionally
            anchored on Solana.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3.5">
            <ActionLink href="/app" variant="lime" size="md" arrow>
              Launch App
            </ActionLink>
            {/* Replaced the inert "Watch Demo" button, which had no handler and
                no destination. This points at the real scanner. */}
            <ActionLink href="/scan" variant="outline" size="md" arrow>
              <Play aria-hidden="true" strokeWidth={1.6} className="size-[17px]" />
              Scan a package
            </ActionLink>
          </div>

          {/* Previously a fixed `lg:w-[748px]` flex row with `whitespace-nowrap`
              labels. Inside a fluid grid column that width exceeded the column
              from 1024px to roughly 1700px, and the column's `z-10` made the
              overflow paint on top of the illustration. This is a fluid 2-up
              grid instead: it cannot exceed its own column at any width, and
              it keeps the two-column editorial band instead of a four-up row
              that would have been ~130px per cell on a laptop. */}
          <ul className="mt-10 grid list-none grid-cols-2 gap-x-5 gap-y-6 sm:gap-x-8 lg:mt-11">
            {HERO_CAPABILITIES.map((item) => (
              <li
                key={item.n}
                className="flex min-w-0 flex-col gap-1.5 border-t border-line-soft pt-3"
              >
                <span className="font-sans text-[30px] leading-none tracking-[-0.03em] text-ink sm:text-[34px]">
                  {item.n}
                </span>
                <span className="mono-label text-[10.5px] leading-[1.35] text-label">
                  {item.title}
                </span>
                <span className="mono-body text-[12.5px] leading-[1.5] text-ink-soft">
                  {item.detail}
                </span>
                <span className="mono-body text-[10.5px] leading-[1.45] text-line">
                  {item.tech}
                </span>
              </li>
            ))}
          </ul>
          <p className="mono-body mt-4 text-[11px] leading-[1.5] tracking-[0.02em] text-label">
            {"// capability summary · live per-deployment counts in the console"}
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Visual column                                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="relative">
          {/* No opaque plate here: the video is blended straight onto the page
              bone so the supporting metrics can sit beside the artwork.

              Aspect ratio is width-led below `lg`, where the artwork has the
              full column to itself. The source plate is portrait (363:387);
              at full mobile width that rendered ~768px of near-empty grey
              above the diagram and pushed the callouts far down the page.
              Once `lg` splits the hero into two columns the artwork is only
              ~660px tall and beside the copy, so the portrait ratio is both
              safe and the better composition there.

              MOBILE BLEED: below `sm` the artwork is pulled out to the
              viewport edges with `-mx-5`, which cancels `.page-shell`'s
              20px inline padding exactly. The video is `object-cover`
              inside an aspect box, so its on-screen size IS its container —
              it was already 100% of the text column and could not grow any
              further while that column kept its gutter. Removing the gutter
              is what makes it visibly bigger on a phone (measured: 280 ->
              320 at a 320px viewport, +14%). The gutters stay symmetric at
              zero, so it remains exactly centred, and because the negative
              margin equals the padding the element ends flush with the
              viewport — no horizontal scroll. `sm:` restores the gutter, so
              tablet and desktop are untouched. */}
          <div className="relative -mx-5 sm:mx-0">
            <div className="relative overflow-hidden">
              <div className="relative aspect-[5/4] w-full sm:aspect-[4/3] lg:aspect-[363/387]">
              {motionAllowed ? (
                <video
                  className="flat-art absolute inset-0 size-full object-cover object-[62%_50%] xl:object-[70%_50%]"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  poster="/hero-poster.jpg"
                  aria-label="Dependency interception, scanner stack and trust layer"
                  tabIndex={-1}
                >
                  <source src="/hero-visuals.mp4" type="video/mp4" />
                </video>
              ) : (
                <img
                  src="/hero-poster.jpg"
                  alt="Dependency interception, scanner stack and trust layer"
                  className="flat-art absolute inset-0 size-full object-cover object-[62%_50%] xl:object-[70%_50%]"
                />
              )}
              </div>
            </div>
          </div>

          {/* Below `xl` these callouts used to be a plain `mt-5` stack under
              the artwork, which read as three unrelated cards trailing the
              image rather than annotations on it. They now share one ruled
              surface with the artwork — a hairline under the plate, equal
              columns, matching rhythm — so the group reads as a single
              diagram. At `xl` and above they return to sitting on the
              artwork, where the column is wide enough to hold 214px tags
              beside the diagram without covering its core. */}
          <ul className="mt-4 grid list-none gap-3 border-t border-line-soft pt-4 sm:grid-cols-3 sm:gap-x-4 xl:absolute xl:inset-x-0 xl:top-0 xl:mt-0 xl:h-full xl:border-0 xl:pt-0">
            {HERO_STAGES.map((stage, index) => (
              <li
                key={stage.label}
                className={`min-w-0 xl:absolute xl:right-0 ${
                  index === 0
                    ? "xl:top-[5%]"
                    : index === 1
                    ? "xl:top-[39%]"
                    : "xl:top-[73%]"
                }`}
              >
                <TagCallout
                  label={stage.label}
                  detail={stage.detail}
                  className="w-full max-w-full xl:w-[214px]"
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}