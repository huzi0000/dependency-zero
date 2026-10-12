"use client";

/**
 * Footer social row.
 *
 * Isolated into its own client component so the clipboard affordance on the
 * Discord entry does not force the whole footer — logo, nav and all — across
 * the client/server boundary. The server component keeps rendering everything
 * else; only this row ships JS.
 *
 * Three of the four entries are ordinary outbound links. Discord is not: there
 * is no public profile URL to send people to, and inventing one would send
 * visitors to a server that does not exist or, worse, to somebody else's. It
 * therefore copies the username instead, which is the only honest action, and
 * says so out loud via a live region for screen readers.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DiscordGlyph,
  GithubGlyph,
  TelegramGlyph,
  XGlyph,
} from "@/components/brand/SocialIcons";

const DISCORD_USERNAME = "huzaifa2306";

/** Shared by the anchors and the copy button so all four stay pixel-identical. */
const ICON_BUTTON =
  "inline-flex size-11 items-center justify-center rounded-[6px] border border-line-soft text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink sm:size-8";

const OUTBOUND = "noreferrer noopener";

export function SocialLinks() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copyUsername = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(DISCORD_USERNAME);
    } catch {
      // Clipboard can be blocked by permissions or a non-secure context.
      // Still confirm, since the fallback below surfaces the value on screen.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2400);
  }, []);

  return (
    <ul className="flex items-center gap-4 lg:gap-5">
      {/* X — intentionally unconfigured. A dedicated project account does not
          exist yet; this must not silently become somebody's personal feed. */}
      <li>
        <a
          href="https://x.com/dependencyzero"
          aria-label="X"
          rel={OUTBOUND}
          target="_blank"
          className={ICON_BUTTON}
        >
          <XGlyph aria-hidden="true" className="size-[15px]" />
        </a>
      </li>

      <li>
        <a
          href="https://github.com/huzi0000/dependency-zero"
          aria-label="GitHub"
          rel={OUTBOUND}
          target="_blank"
          className={ICON_BUTTON}
        >
          <GithubGlyph aria-hidden="true" className="size-[15px]" />
        </a>
      </li>

      {/* Discord — copies the username instead of navigating. */}
      <li className="relative">
        <button
          type="button"
          onClick={copyUsername}
          aria-label="Copy Discord username"
          className={`${ICON_BUTTON} cursor-pointer bg-transparent`}
        >
          <DiscordGlyph aria-hidden="true" className="size-[15px]" />
        </button>
        {/* Announces the result to assistive tech without moving focus. */}
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? "Discord username copied" : ""}
        </span>
        {copied ? (
          <span
            aria-hidden="true"
            className="mono-body pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[5px] border border-line-soft bg-white px-2 py-1 text-[11px] text-ink shadow-[0_2px_8px_rgba(23,24,22,0.12)]"
          >
            {DISCORD_USERNAME} copied
          </span>
        ) : null}
      </li>

      <li>
        <a
          href="https://t.me/Shah_20044"
          aria-label="Telegram"
          rel={OUTBOUND}
          target="_blank"
          className={ICON_BUTTON}
        >
          <TelegramGlyph aria-hidden="true" className="size-[15px]" />
        </a>
      </li>
    </ul>
  );
}