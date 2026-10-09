/* Asserts the x-axis labels never overlap, at every breakpoint and range. */
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const WIDTHS = [1440, 1280, 1024, 768, 390, 360];
const RANGES = ["24H", "7D", "30D", "ALL"];

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
let failures = 0;

for (const range of RANGES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(`${base}/app?range=${range}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      const texts = [...document.querySelectorAll("svg text")].filter((t) =>
        /^(\d{2}:\d{2}|\d{1,2}\/\d{1,2})$/.test(t.textContent?.trim() ?? ""),
      );
      const boxes = texts.map((t) => {
        const b = t.getBoundingClientRect();
        return { label: t.textContent?.trim(), left: b.left, right: b.right, width: b.width };
      }).sort((a, b) => a.left - b.left);

      const overlaps = [];
      for (let i = 1; i < boxes.length; i++) {
        const gap = boxes[i].left - boxes[i - 1].right;
        if (gap < 4) overlaps.push(`${boxes[i - 1].label}|${boxes[i].label} gap=${gap.toFixed(1)}`);
      }

      const svg = document.querySelector("svg[role='img']");
      const svgBox = svg?.getBoundingClientRect();
      const clipped = boxes.filter(
        (b) => svgBox && (b.left < svgBox.left - 0.5 || b.right > svgBox.right + 0.5),
      );

      return { labels: boxes.map((b) => b.label), overlaps, clipped: clipped.map((c) => c.label) };
    });

    const ok = result.overlaps.length === 0 && result.clipped.length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${range.padEnd(4)} ${String(width).padStart(4)}px  ` +
        `labels=[${result.labels.join(" ")}]` +
        (result.overlaps.length ? `  OVERLAP: ${result.overlaps.join(", ")}` : "") +
        (result.clipped.length ? `  CLIPPED: ${result.clipped.join(", ")}` : ""),
    );
    await page.close();
  }
}

console.log(`\n${failures === 0 ? "PASS — labels never overlap or clip" : `FAIL — ${failures} case(s)`}`);
await browser.close();
