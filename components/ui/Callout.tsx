/**
 * Technical callouts used across the page.
 *
 *  - `tag`  : bordered technical tag (angled leading edge) + optional
 *             descriptor panel, wired to the artwork with a thin connector.
 *             Used for SCAN / VERIFY / PROTECT in the hero.
 *  - `tick` : small lime bullet + uppercase mono caption, absolutely placed
 *             over the globe / platform artwork.
 */

const TAG_CLIP = "polygon(20px 0, 100% 0, 100% 100%, 0 100%, 0 22%, 20px 0)";

function TagConnector() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 92 12"
      className="absolute top-[22px] right-full mr-[8px] h-[12px] w-[92px] -translate-y-1/2 text-ink"
    >
      <line
        x1="8"
        y1="6"
        x2="88"
        y2="6"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.75"
      />
      <circle cx="6" cy="6" r="5" fill="var(--color-lime)" />
      <circle cx="6" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}

export function TagCallout({
  label,
  detail,
  className = "",
  detailClassName = "",
}: {
  label: string;
  detail: string;
  className?: string;
  detailClassName?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* The leader line only makes sense once the callout sits beside the art. */}
      <span className="hidden xl:block">
        <TagConnector />
      </span>
      {/* 1px border achieved with a clipped outer plate + clipped inner plate */}
      <div style={{ clipPath: TAG_CLIP }} className="rule-edge">
        <div
          style={{ clipPath: TAG_CLIP }}
          className="bg-surface px-[22px] pt-[9px] pb-[10px]"
        >
          <span className="font-sans text-[19px] font-bold tracking-[0.015em] text-ink">
            {label}
          </span>
        </div>
      </div>
      <div
        className={`mt-[6px] rounded-[5px] border border-[#C3BFB2] bg-surface/95 px-[14px] py-[9px] ${detailClassName}`}
      >
        <span className="mono-body block text-[12.5px] leading-[1.45] text-ink-soft">
          {detail}
        </span>
      </div>
    </div>
  );
}

export function TickCallout({
  children,
  tone = "onDark",
  className = "",
}: {
  children: React.ReactNode;
  /** `onDark` for the black network section, `ink` on the bone page. */
  tone?: "onDark" | "ink";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[9px] whitespace-nowrap ${
        tone === "ink" ? "text-ink" : "text-[#EDEDEA]"
      } ${className}`}
    >
      <span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-lime" />
      <span className="mono-label text-[11.5px] leading-none">{children}</span>
    </span>
  );
}