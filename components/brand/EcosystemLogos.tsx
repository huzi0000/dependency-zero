/**
 * Authentic Solana-ecosystem brand marks, stored locally in /public/brands.
 * Sourced from each project's own repository (Backpack's brand folder, Helius'
 * official boilerplate, Raydium's UI repo and the Jito Foundation portal) and
 * flattened to a single ink colour so the ticker reads as a restrained
 * monochrome strip.
 *
 * No endorsement, partnership or "trusted by" claim is implied by this list.
 */

export type EcosystemBrand = {
  id: string;
  name: string;
  src: string;
  /** Intrinsic size of the official asset, so the mark is never distorted. */
  width: number;
  height: number;
  /** Optical box height — mark-only logos sit larger than wordmark lockups. */
  box?: number;
};

export const SOLANA_ECOSYSTEM_BRANDS: EcosystemBrand[] = [
  { id: "solana", name: "Solana", src: "/brands/solana.svg", width: 200, height: 24, box: 30 },
  { id: "phantom", name: "Phantom", src: "/brands/phantom.svg", width: 593, height: 493, box: 44 },
  { id: "backpack", name: "Backpack", src: "/brands/backpack.svg", width: 124, height: 24, box: 30 },
  { id: "helius", name: "Helius", src: "/brands/helius.svg", width: 562, height: 118, box: 32 },
  { id: "raydium", name: "Raydium", src: "/brands/raydium.svg", width: 120, height: 33, box: 32 },
  { id: "jito", name: "Jito", src: "/brands/jito.png", width: 600, height: 237, box: 36 },
];

const TRACK_SLOT = 168; // width of one slot; see EcosystemMarquee for the loop maths

export function BrandMark({ brand }: { brand: EcosystemBrand }) {
  const cap = brand.box ?? 32;
  return (
    <span
      className="flex h-[48px] shrink-0 items-center justify-center"
      style={{ width: TRACK_SLOT }}
    >
      <img
        src={brand.src}
        alt={brand.name}
        width={brand.width}
        height={brand.height}
        loading="lazy"
        decoding="async"
        className="h-auto w-auto opacity-75"
        style={{ maxHeight: cap, maxWidth: TRACK_SLOT }}
      />
    </span>
  );
}