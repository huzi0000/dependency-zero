/* Deterministic visual-QA renderer.
   Usage: node qa/shot.mjs <width> <height> <outfile> [url]
*/
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const width = Number(process.argv[2] ?? 1440);
const height = Number(process.argv[3] ?? 1000);
const out = resolve(process.argv[4] ?? "qa/shot.png");
const url = process.argv[5] ?? "http://localhost:3000/";

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => errors.push(`[failed] ${r.url()} ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
// Walk the page so lazy images below the fold actually load before the capture.
await page.evaluate(async () => {
  const step = window.innerHeight * 0.8;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 150));
  }
  window.scrollTo(0, 0);
});
await page.waitForFunction(
  () => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0),
  null,
  { timeout: 30000 },
).catch(() => {});
await page.waitForTimeout(700);
// Pause the marquee + float loops so successive shots are comparable.
await page.addStyleTag({
  content: `*,*::before,*::after{animation:none !important;transition:none !important}
            .reveal{opacity:1 !important;transform:none !important}`,
});
await page.waitForTimeout(900);

const metrics = await page.evaluate(() => {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const over = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1.5 || r.left < -1.5) {
      const style = getComputedStyle(el);
      if (style.position === "absolute" && el.closest(".marquee")) continue;
      if (el.closest("[data-bleed]")) continue;
      over.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  }

  // Vertical rhythm + key box geometry, to compare against the reference.
  const R = 1.78; // reference px -> css px
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)];
  };
  const sections = [...document.querySelectorAll("header, main > section, main > div, footer")].map(
    (el) => {
      const r = el.getBoundingClientRect();
      const h2 = el.querySelector("h1, h2");
      return {
        name:
          (el.getAttribute("aria-labelledby") && h2?.id) ||
          el.tagName.toLowerCase() +
            (el.className?.baseVal ?? el.className ?? "").toString().split(" ")[0],
        top: Math.round(r.y + window.scrollY),
        h: Math.round(r.height),
      };
    },
  );

  return {
    vw,
    scrollWidth: doc.scrollWidth,
    scrollHeight: doc.scrollHeight,
    horizontalOverflow: doc.scrollWidth > vw + 1,
    offenders: over.slice(0, 14),
    nav: pick("header nav"),
    logo: pick("header nav img"),
    navBtn: pick("header nav a[href='/app']"),
    h1sans: pick("h1 span"),
    h1serif: pick("h1 span + span"),
    heroDesc: pick("h1 + p"),
    heroVis: pick("video"),
    metrics: pick("dl"),
    marqueeRule: pick("section[aria-labelledby='ecosystem-heading'] .page-shell"),
    marqueeTrack: pick(".marquee-track"),
    problemGrid: pick("section#product .page-shell > div"),
    problemCards: pick("section#product ul"),
    dark: pick("section#network"),
    howGrid: pick("section[aria-labelledby='how-heading'] ol"),
    howCard: pick("section[aria-labelledby='how-heading'] ol article"),
    howTerminal: pick("section[aria-labelledby='how-heading'] ol article > div:last-child"),
    ctaGrid: pick("section[aria-labelledby='cta-heading'] .page-shell > div"),
    ctaArt: pick("img[alt^='Isometric']"),
    footer: pick("footer"),
    sections,
  };
});

await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(JSON.stringify({ out, ...metrics, errors: errors.slice(0, 20) }, null, 2));