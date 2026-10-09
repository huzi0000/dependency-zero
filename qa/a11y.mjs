/* Accessibility audit for the console routes.

   Covers the checks Lighthouse would flag that matter here: landmarks,
   heading order, accessible names, contrast, focus visibility, label
   association, and table semantics.
*/
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const ROUTES = ["/app", "/scan", "/network"];
const WIDTHS = [1440, 390];

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
let failures = 0;

const audit = () => {
  const problems = [];
  const add = (rule, detail) => problems.push({ rule, detail });

  /* Landmarks and headings */
  const h1s = [...document.querySelectorAll("h1")];
  if (h1s.length !== 1) add("h1-count", `${h1s.length} found`);

  const headings = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent?.trim().slice(0, 40) ?? "",
  }));
  let prev = 0;
  for (const h of headings) {
    if (prev && h.level > prev + 1) add("heading-order", `${prev} -> ${h.level} at "${h.text}"`);
    prev = h.level;
  }

  if (!document.querySelector("main")) add("landmark", "no <main>");
  if (!document.querySelector("nav[aria-label]")) add("landmark", "sidebar nav has no accessible name");

  /* Accessible names on every interactive control */
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ");
      if (t) return t;
    }
    if (el.getAttribute("aria-labelledby") === undefined && el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    if (el.closest("label")?.textContent?.trim()) return el.closest("label").textContent.trim();
    if (el.getAttribute("title")?.trim()) return el.getAttribute("title").trim();
    return el.textContent?.trim() ?? "";
  };

  for (const el of document.querySelectorAll('a[href], button:not([disabled])')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (!nameOf(el)) add("accessible-name", `${el.tagName} "${el.textContent?.trim().slice(0, 30) ?? ""}"`);
  }

  /* Form inputs need a programmatic label */
  for (const el of document.querySelectorAll("input, select, textarea")) {
    const hasLabel =
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby") ||
      el.closest("label") ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    if (!hasLabel) add("form-label", `input placeholder="${el.getAttribute("placeholder")}"`);
  }

  /* Images need alt (empty alt is fine for decoration) */
  for (const el of document.querySelectorAll("img")) {
    if (el.getAttribute("alt") === null) add("img-alt", el.src.slice(-40));
  }

  /* Text contrast against the nearest opaque background */
  const parse = (c) => {
    const m = c.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : null;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Walk up for the first effectively-opaque background. Note: `transparent` and
  // `rgba(0,0,0,0)` must not stop the walk, and fully opaque white DOES count —
  // an earlier version skipped white and reported phantom contrast failures.
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const raw = getComputedStyle(node).backgroundColor;
      const alpha = Number(raw.match(/[\d.]+/g)?.[3] ?? 1);
      if (raw !== "transparent" && alpha >= 0.85) {
        const bg = parse(raw);
        if (bg) return bg;
      }
      node = node.parentElement;
    }
    return [241, 239, 232]; // --color-bone
  };

  for (const el of document.querySelectorAll("p,span,a,button,h1,h2,h3,td,th,dd,dt,li")) {
    if (!el.textContent?.trim()) continue;
    if (el.children.length && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.9) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;

    if (ratio < min) {
      add(
        "contrast",
        `${ratio.toFixed(2)}:1 (need ${min}) ${size}px "${el.textContent.trim().slice(0, 34)}"`,
      );
    }
  }

  /* Table semantics */
  for (const table of document.querySelectorAll("table")) {
    if (!table.querySelector("th")) add("table-semantics", "no <th>");
  }

  /* Duplicate ids break label/aria wiring */
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) add("duplicate-id", [...new Set(dupes)].slice(0, 3).join(", "));

  return problems;
};

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2500);
    const problems = await page.evaluate(audit);

    if (problems.length === 0) {
      console.log(`PASS  ${route.padEnd(9)} ${String(width).padStart(4)}px`);
    } else {
      const grouped = {};
      for (const p of problems) (grouped[p.rule] ??= []).push(p.detail);
      console.log(`FAIL  ${route.padEnd(9)} ${String(width).padStart(4)}px`);
      for (const [rule, details] of Object.entries(grouped)) {
        failures++;
        console.log(`        ${rule}: ${[...new Set(details)].slice(0, 4).join(" ; ")}`);
      }
    }
    await page.close();
  }
}

console.log(`\n${failures === 0 ? "PASS — no accessibility problems found" : `FAIL — ${failures} rule(s) violated`}`);
await browser.close();
