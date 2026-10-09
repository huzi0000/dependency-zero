"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionLink } from "@/components/ui/Button";

const NAV_LINKS = [
  { label: "Product", href: "/#product" },
  { label: "Network", href: "/#network" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/#pricing" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet on Escape and lock body scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled ? "border-line bg-bone" : "border-transparent bg-bone"
      }`}
    >
      <nav
        aria-label="Primary"
        className="page-shell flex h-[66px] items-center justify-between gap-6 lg:h-[80px]"
      >
        <Link
          href="/"
          className="shrink-0 rounded-[4px]"
          aria-label="Dependency Zero — home"
         prefetch={false}>
          <Image
            src="/brand/logo-trimmed.png"
            alt="Dependency Zero"
            width={2010}
            height={349}
            priority
            className="h-[38px] w-auto lg:h-[50px]"
          />
        </Link>

        <ul className="hidden items-center gap-9 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="rounded-[4px] text-[14px] font-medium text-ink-soft transition-colors duration-200 hover:text-ink"
               prefetch={false}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <span className="hidden sm:block">
            <ActionLink href="/app" variant="ink" size="sm" arrow>
              Launch App
            </ActionLink>
          </span>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            className="inline-flex h-11 w-11 items-center justify-center rounded-[6px] border border-line text-ink transition-colors duration-200 hover:border-ink lg:hidden"
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              {open ? (
                <>
                  <path d="M4 4l12 12" />
                  <path d="M16 4L4 16" />
                </>
              ) : (
                <>
                  <path d="M3 6h14" />
                  <path d="M3 10h14" />
                  <path d="M3 14h14" />
                </>
              )}
            </svg>
          </button>
        </div>
      </nav>

      <div
        id="mobile-navigation"
        hidden={!open}
        className="border-t border-line bg-bone lg:hidden"
      >
        <ul className="page-shell flex flex-col gap-1 py-5">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                prefetch={false}
                className="block rounded-[6px] px-2 py-3 text-[17px] font-medium text-ink transition-colors duration-200 hover:bg-surface"
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li className="pt-3 sm:hidden">
            <ActionLink href="/app" variant="ink" size="md" arrow className="w-full">
              Launch App
            </ActionLink>
          </li>        </ul>
      </div>
    </header>
  );
}