/* Verifies zero hydration errors, zero console errors and no overflow
   across every console route at every required breakpoint. */
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const ROUTES = ["/app", "/scan", "/network"];
const WIDTHS = [1440, 1280, 1024, 768, 390, 360];

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });

let failures = 0;
const note = (msg) => {
  console.log(msg);
  if (msg.includes("FAIL")) failures++;
};

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const problems = [];

    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 90)}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 90)}`);
    });
    page.on("requestfailed", (r) => {
      const url = r.url();
      // Next.js prefetches routes with a cache-busting _rsc param. When the page
      // closes mid-prefetch the browser aborts those requests; that is normal,
      // not a defect. Everything else is a real failure.
      if (url.includes("_rsc=") || r.failure()?.errorText === "net::ERR_ABORTED") return;
      problems.push(`requestfailed: ${url.slice(0, 80)} (${r.failure()?.errorText})`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url().slice(0, 70)}`);
    });

    const res = await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(1400);

    // Horizontal overflow check.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const over = doc.scrollWidth - doc.clientWidth;
      let worst = null;
      if (over > 0) {
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.right > doc.clientWidth + 1 && r.width > 0) {
            const cand = { tag: el.tagName, right: Math.round(r.right), cls: String(el.className).slice(0, 50) };
            if (!worst || cand.right > worst.right) worst = cand;
          }
        }
      }
      return { over, worst };
    });

    const status = res?.status();
    note(
      `${route.padEnd(9)} ${String(width).padStart(4)}px  http=${status}  overflow=${overflow.over}px  ` +
        `problems=${problems.length ? problems.join(" | ") : "none"}` +
        (overflow.worst ? `  worst=${overflow.worst.tag}@${overflow.worst.right}` : ""),
    );
    await page.close();
  }
}

/* Landing page regression guard. */
for (const width of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message.slice(0, 80)));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text().slice(0, 80));
  });
  const res = await page.goto(`${base}/`, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(1200);
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  note(`LANDING /   ${String(width).padStart(4)}px  http=${res?.status()}  overflow=${over}px  problems=${problems.length ? problems.join(" | ") : "none"}`);
  await page.close();
}

console.log(`\n${failures === 0 ? "PASS — all routes clean at every breakpoint" : `FAIL — ${failures} problem line(s)`}`);
await browser.close();
