/* Screenshot every console route at every required breakpoint. */
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const out = process.argv[2] || "C:/Users/HUZAIFA/AppData/Local/Temp/opencode/qa/shots";
const ROUTES = [
  ["app", "/app"],
  ["scan", "/scan"],
  ["network", "/network"],
  ["report", "/scan"],
];
const WIDTHS = [1440, 1280, 1024, 768, 390, 360];

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });

for (const [name, route] of ROUTES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2500);
    const file = `${out}/${name}-${width}.png`;
    const box = await page.evaluate(() => ({
      h: document.documentElement.scrollHeight,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${file}  height=${box.h} overflow=${box.over}`);
    await page.close();
  }
}
await browser.close();
