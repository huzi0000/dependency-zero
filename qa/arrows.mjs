/* Measure rendered arrow placement relative to the card gaps. */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/", { waitUntil: "load", timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: `.reveal{opacity:1 !important;transform:none !important}` });
await page.waitForTimeout(700);

const data = await page.evaluate(() => {
  const list = document.querySelector('[role="list"]');
  const cards = [...list.querySelectorAll('article')];
  const arrows = [...list.querySelectorAll('span[aria-hidden="true"]')].filter(
    (s) => s.querySelector('svg'),
  );
  const cardBox = cards.map((c) => {
    const r = c.getBoundingClientRect();
    return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) };
  });
  const arrowBox = arrows.map((a) => {
    const glyph = a.querySelector("svg");
    const r = (glyph ?? a).getBoundingClientRect();
    return {
      l: Math.round(r.left),
      r: Math.round(r.right),
      c: Math.round((r.left + r.right) / 2),
      cy: Math.round((r.top + r.bottom) / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  return { cardBox, arrowBox };
});

const gap = data.cardBox[1].l - data.cardBox[0].r;
console.log(`card widths : ${data.cardBox.map((c) => c.r - c.l).join(", ")}`);
console.log(`card heights: ${data.cardBox.map((c) => c.b - c.t).join(", ")}`);
console.log(`gaps        : ${data.cardBox[0].r}->${data.cardBox[1].l}  and  ${data.cardBox[1].r}->${data.cardBox[2].l}  (each ${gap}px)`);
console.log("");
data.arrowBox.forEach((a, i) => {
  const left = data.cardBox[i];
  const right = data.cardBox[i + 1];
  const mid = (left.r + right.l) / 2;
  const clearL = a.l - left.r;
  const clearR = right.l - a.r;
  const ok = Math.abs(a.c - mid) < 0.6 && clearL >= 4 && clearR >= 4;
  console.log(
    `arrow ${i + 1}: glyph ${a.w}x${a.h} box [${a.l}..${a.r}] centre=${a.c}  gap centre=${Math.round(mid)}  ` +
      `offset=${Math.round(a.c - mid)}px  clearance left=${clearL}px right=${clearR}px  ${ok ? "OK" : "FAIL"}`,
  );
});
const midY = (data.cardBox[0].t + data.cardBox[0].b) / 2;
data.arrowBox.forEach((a, i) =>
  console.log(`arrow ${i + 1}: vertical centre=${a.cy} card centre=${Math.round(midY)} offset=${a.cy - Math.round(midY)}px`),
);
const widest = Math.max(...data.cardBox.map((c) => c.r), ...data.arrowBox.map((a) => a.r));
console.log(`\nrightmost content edge=${widest}  viewport=1440  overflow=${widest > 1440}`);
await browser.close();