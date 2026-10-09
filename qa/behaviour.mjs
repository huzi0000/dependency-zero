/* Behavioural checks: mobile menu, keyboard focus, reduced motion, a11y tree.
   Usage: node qa/behaviour.mjs [width]
*/
import { chromium } from "playwright-core";

const width = Number(process.argv[2] ?? 1440);
const results = [];
const ok = (name, pass, note = "") => results.push({ name, pass, note });

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });

/* ---------------------------------------------------------------- mobile */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3000/", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const trigger = page.locator('button[aria-controls="mobile-navigation"]');
  ok("mobile menu trigger visible", await trigger.isVisible());
  ok("menu starts collapsed", !(await page.locator("#mobile-navigation").isVisible()));

  await trigger.click();
  await page.waitForTimeout(350);
  const sheet = page.locator("#mobile-navigation");
  ok("menu opens on tap", await sheet.isVisible());
  ok("menu exposes aria-expanded", (await trigger.getAttribute("aria-expanded")) === "true");
  ok("menu contains Launch App", await sheet.getByRole("link", { name: /launch app/i }).isVisible());
  ok("body scroll locked while open", (await page.evaluate(() => document.body.style.overflow)) === "hidden");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  ok("menu closes on Escape", !(await sheet.isVisible()));
  ok("body scroll restored", (await page.evaluate(() => document.body.style.overflow)) !== "hidden");

  await trigger.click();
  await page.waitForTimeout(300);
  const docW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok("no horizontal overflow with menu open", docW <= 391, `scrollWidth=${docW}`);
  await page.close();
}

/* ------------------------------------------------------- keyboard focus */
{
  const page = await browser.newPage({ viewport: { width: width, height: 900 } });
  await page.goto("http://localhost:3000/", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => {
    const el = document.activeElement;
    // Accessible name for a link wrapping an <img alt="..."> comes from the alt.
    const name =
      el.getAttribute("aria-label") ||
      (el.querySelector("img[alt]") || {}).alt ||
      (el.textContent || "").trim();
    return { tag: el.tagName, name: String(name).slice(0, 40) };
  });
  ok("first tab stop is the home link", first.tag === "A" && /dependency zero/i.test(first.name), JSON.stringify(first));

  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle };
  });
  ok("focus ring is visible", ring.outlineStyle !== "none" && parseFloat(ring.outlineWidth) >= 2, JSON.stringify(ring));

  /* Skip link is not required by the brief; verify heading order instead. */
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => Number(h.tagName[1])),
  );
  let orderOk = headings[0] === 1;
  for (let i = 1; i < headings.length; i++) if (headings[i] - headings[i - 1] > 1) orderOk = false;
  ok("heading hierarchy has no skips", orderOk, headings.join(","));

  const landmarks = await page.evaluate(() => ({
    header: document.querySelectorAll("header").length,
    nav: document.querySelectorAll("nav").length,
    main: document.querySelectorAll("main").length,
    footer: document.querySelectorAll("footer").length,
    h1: document.querySelectorAll("h1").length,
  }));
  ok("landmarks present", landmarks.header === 1 && landmarks.main === 1 && landmarks.footer === 1 && landmarks.nav >= 1 && landmarks.h1 === 1, JSON.stringify(landmarks));

  const media = await page.evaluate(() =>
    [...document.querySelectorAll("video,img")].map((m) => ({
      tag: m.tagName,
      alt: m.getAttribute("alt"),
      label: m.getAttribute("aria-label"),
      loading: m.getAttribute("loading"),
    })),
  );
  const missingAlt = media.filter((m) => !m.alt && !m.label);
  ok("all media labelled", missingAlt.length === 0, JSON.stringify(missingAlt));

  const videoAttrs = await page.evaluate(() => {
    const v = document.querySelector("video");
    return {
      autoplay: v.autoplay,
      muted: v.muted,
      loop: v.loop,
      playsInline: v.playsInline,
      controls: v.controls,
    };
  });
  ok(
    "video: autoplay+muted+loop+playsInline, no native controls",
    videoAttrs.autoplay && videoAttrs.muted && videoAttrs.loop && videoAttrs.playsInline && !videoAttrs.controls,
    JSON.stringify(videoAttrs),
  );

  const copy = await page.evaluate(() => document.body.innerText);
  ok("no endorsement claim", !/trusted by/i.test(copy), /trusted by/i.exec(copy)?.[0] ?? "");
  ok("light theme only (no dark-mode toggle)", !/theme\s*toggle|dark\s*mode/i.test(copy));

  await page.close();
}

/* ------------------------------------------------------ reduced motion */
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await page.goto("http://localhost:3000/", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => {
    const track = document.querySelector(".marquee-track");
    const cs = getComputedStyle(track);
    const reveals = [...document.querySelectorAll(".reveal")].map((r) => getComputedStyle(r).opacity);
    return {
      marqueeAnimation: cs.animationName,
      marqueeDuration: cs.animationDuration,
      marqueeScrollable: getComputedStyle(document.querySelector(".marquee")).overflowX,
      minRevealOpacity: Math.min(...reveals),
    };
  });
  ok("marquee animation disabled under reduced motion", state.marqueeAnimation === "none", JSON.stringify(state));
  ok("marquee remains reachable (scrollable)", state.marqueeScrollable === "auto" || state.marqueeScrollable === "scroll", state.marqueeScrollable);
  ok("revealed content is visible under reduced motion", Number(state.minRevealOpacity) > 0.9, String(state.minRevealOpacity));
  await page.close();
}

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.note ? "  — " + r.note : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);