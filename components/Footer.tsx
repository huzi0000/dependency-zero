import Image from "next/image";
import Link from "next/link";
import {
  DiscordGlyph,
  GithubGlyph,
  TelegramGlyph,
  XGlyph,
} from "@/components/brand/SocialIcons";

/** Compact single-row footer: logo · links · socials · copyright. */
const LINKS = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Product", href: "/#product" },
  { label: "Network", href: "/network" },
  { label: "Scanner", href: "/scan" },
  { label: "Console", href: "/app" },
];

const SOCIALS = [
  { label: "X", href: "https://x.com/dependencyzero", Icon: XGlyph },
  { label: "GitHub", href: "https://github.com/dependency-zero", Icon: GithubGlyph },
  { label: "Discord", href: "https://discord.gg/dependencyzero", Icon: DiscordGlyph },
  { label: "Telegram", href: "https://t.me/dependencyzero", Icon: TelegramGlyph },
];

export function Footer() {
  return (
    <footer className="mt-[56px] pb-6 lg:mt-[64px]">
      <div className="page-shell">
        <div className="flex flex-col items-start gap-7 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          {/* Identity ---------------------------------------------------- */}
          <Link
            href="/"
            prefetch={false}
            className="shrink-0 rounded-[4px]"
            aria-label="Dependency Zero — home"
          >
            <Image
              src="/brand/logo-trimmed.png"
              alt="Dependency Zero"
              width={2010}
              height={349}
              loading="lazy"
              className="h-[30px] w-auto lg:h-[34px]"
            />
          </Link>

          {/* Links ------------------------------------------------------ */}
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-8 gap-y-2">
              {LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    className="dz-tap rounded-[4px] text-[14px] text-ink-soft transition-colors duration-200 hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Socials ---------------------------------------------------- */}
          <ul className="flex items-center gap-4 lg:gap-5">
            {SOCIALS.map(({ label, href, Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  aria-label={label}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="inline-flex size-11 items-center justify-center rounded-[6px] border border-line-soft text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink sm:size-8"
                >
                  <Icon aria-hidden="true" className="size-[15px]" />
                </a>
              </li>
            ))}
          </ul>

          {/* Copyright ------------------------------------------------- */}
          {/* `whitespace-nowrap` was here and forced a 302px line inside a ~278px
             content column at phone width, pushing the footer's scroll width
             past the viewport. It is a sentence, not a label, so it is allowed
             to wrap. */}
          <p className="mono-body text-[12px] text-label">
            © {new Date().getFullYear()} Dependency Zero. Built on Solana.
          </p>
        </div>
      </div>
    </footer>
  );
}