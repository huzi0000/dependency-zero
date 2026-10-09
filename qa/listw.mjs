/* Diagnose any overflow from the 3-card list at a given width. */
import { chromium } from "playwright-core";

const width = Number(process.argv[2] ?? 1024);
const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/", { waitUntil: "load", timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: `.reveal{opacity:1 !important;transform:none !important}` });
await page.waitForTimeout(700);

const out = await page.evaluate(() => {
  const vw = window.innerWidth;
  const list = document.querySelector("[role='list']");
  const lr = list.getBoundingClientRect();
  const kids = [...list.children].map((c) => {
    const r = c.getBoundingClientRect();
    return {
      tag: c.tagName.toLowerCase(),
      role: c.getAttribute("role") ?? "",
      hidden: getComputedStyle(c).display === "none",
      l: Math.round(r.left),
      r: Math.round(r.right),
      w: Math.round(r.width),
    };
  });
  // widest min-content contributor inside each card
  const tight = [...list.querySelectorAll("article")].map((a) => {
    const probe = a.cloneNode(true);
    probe.style.cssText = "position:absolute;visibility:hidden;width:min-content;left:-9999px";
    document.body.appendChild(probe);
    const w = Math.round(probe.getBoundingClientRect().width);
    probe.remove();
    return w;
  });
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1.5 && !el.closest(".marquee")) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 60),
        r: Math.round(r.right),
      });
    }
  }
  return {
    vw,
    listW: Math.round(lr.width),
    listL: Math.round(lr.left),
    listR: Math.round(lr.right),
    kids,
    cardMinContent: tight,
    docScroll: document.documentElement.scrollWidth,
    offenders: offenders.slice(0, 6),
  };
});

console.log(JSON.stringify(out, null, 1));
await browser.close();