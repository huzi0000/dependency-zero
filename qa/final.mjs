/* Final verification: arrow visibility per breakpoint + full error listing. */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });

for (const width of [1440, 1280, 1024, 768, 640, 390, 360]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const msgs = [];
  page.on("console", (m) => {
    if (m.type() === "error") msgs.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => msgs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) msgs.push(`http ${r.status()}: ${r.url()}`);
  });

  await page.goto("http://localhost:3000/", { waitUntil: "load", timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: `.reveal{opacity:1 !important;transform:none !important}` });
  await page.waitForTimeout(800);

  const r = await page.evaluate(() => {
    const list = document.querySelector("[role='list']");
    const arrows = [...list.querySelectorAll("span[aria-hidden='true']")].filter((s) =>
      s.querySelector("svg"),
    );
    const cards = [...list.querySelectorAll("article")].map((c) => {
      const b = c.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right) };
    });
    return {
      arrowCount: arrows.length,
      visibleArrows: arrows.filter((a) => a.getBoundingClientRect().width > 0).length,
      cardW: cards.map((c) => c.r - c.l),
      docScroll: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      heading: document.querySelector("#how-heading")?.textContent?.replace(/\s+/g, " ").trim(),
      listRole: list.getAttribute("role"),
      itemRoles: [...list.querySelectorAll("[role='listitem']")].length,
    };
  });

  const overflow = r.docScroll > r.vw;
  const real = msgs.filter((m) => !/ERR_ABORTED|favicon/i.test(m));
  console.log(
    `${String(width).padEnd(5)} arrows ${r.visibleArrows}/${r.arrowCount} visible | cardW ${r.cardW.join(",")} | ` +
      `overflow=${overflow} | listItems=${r.itemRoles} | errors=${real.length ? real.join(" ; ") : "none"}`,
  );
  await page.close();
}
await browser.close();
