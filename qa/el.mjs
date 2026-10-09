/* Element / region screenshot for close visual QA.
   Usage: node qa/el.mjs <width> <selector> <out.png> [url] [paddingPx]
*/
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const width = Number(process.argv[2] ?? 1440);
const selector = process.argv[3] ?? "body";
const out = resolve(process.argv[4] ?? "qa/el.png");
const url = process.argv[5] ?? "http://localhost:3000/";
const pad = Number(process.argv[6] ?? 0);

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(async () => {
  const step = window.innerHeight * 0.8;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1200);
await page.addStyleTag({
  content: `*,*::before,*::after{animation:none !important;transition:none !important}
            .reveal{opacity:1 !important;transform:none !important}`,
});
await page.waitForTimeout(800);

const el = page.locator(selector).first();
await el.scrollIntoViewIfNeeded();
await page.waitForFunction(
  () => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0),
  null,
  { timeout: 30000 },
).catch(() => {});
await page.waitForTimeout(500);

const imgs = await page.evaluate(() =>
  [...document.querySelectorAll("img")].map((i) => {
    const r = i.getBoundingClientRect();
    return {
      alt: i.alt,
      src: (i.currentSrc || i.src).split("/").pop().slice(0, 70),
      natural: [i.naturalWidth, i.naturalHeight],
      complete: i.complete,
      rect: [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)],
    };
  }),
);
console.log(JSON.stringify({ imgs }, null, 1));

const box = await el.boundingBox();
if (!box) throw new Error(`no box for ${selector}`);
await page.screenshot({
  path: out,
  clip: {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(width, box.width + pad * 2),
    height: box.height + pad * 2,
  },
});
await browser.close();
console.log(JSON.stringify({ out, box }));