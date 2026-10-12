import {
  BrandMark,
  SOLANA_ECOSYSTEM_BRANDS,
} from "@/components/brand/EcosystemLogos";

/**
 * The track renders the brand list twice and translates by exactly -50%, so the
 * loop is seamless. `gap-[80px]` with `px-10` (half the gap) guarantees the
 * visual period divides the track width in half:
 *   W = 40 + 2n*168 + (2n-1)*80 + 40 = 496n  ->  W/2 = 248n = n * (168 + 80)
 */
export function EcosystemMarquee() {
  const track = [...SOLANA_ECOSYSTEM_BRANDS, ...SOLANA_ECOSYSTEM_BRANDS];

  return (
    <section aria-labelledby="ecosystem-heading" className="pt-[68px] lg:pt-[86px]">
      <div className="page-shell">
        <div className="flex items-center gap-5 sm:gap-7">
          <span aria-hidden="true" className="h-px flex-1 bg-line-soft" />
          <h2
            id="ecosystem-heading"
            className="mono-label min-w-0 text-center text-[11px] text-ink [letter-spacing:0.12em] sm:text-[11.5px] sm:[letter-spacing:0.16em]"
          >
            Built for the Solana ecosystem
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line-soft" />
        </div>
      </div>

      <div className="marquee mt-7 overflow-hidden lg:mt-8">
        <div className="marquee-track flex w-max items-center gap-20 px-10">
          {track.map((brand, index) => (
            <BrandMark key={`${brand.id}-${index}`} brand={brand} />
          ))}
        </div>
      </div>
    </section>
  );
}