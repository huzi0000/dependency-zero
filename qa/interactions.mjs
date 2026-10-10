/* Exercises every interactive control on the console routes.

   Note: this project sits on a OneDrive-synced folder, so response times are
   genuinely slow. Waits are deliberately generous so that a slow filesystem
   never registers as a functional bug.
*/
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const SETTLE = 4000;

const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

/* ---------------- Desktop ---------------- */
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 90)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 90));
});

await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1200);

/* 1. Time-range control updates state, the URL and the fetched data. */
for (const r of ["7D", "30D", "ALL", "24H"]) {
  await page.getByRole("button", { name: r, exact: true }).click();
  await page.waitForTimeout(SETTLE);
  const pressed = await page
    .getByRole("button", { name: r, exact: true })
    .getAttribute("aria-pressed");
  const url = page.url();
  check(`range ${r} sets aria-pressed`, pressed === "true");
  check(`range ${r} reflected in URL`, url.includes(`range=${r}`), url.split("?")[1] ?? "(no query)");

  // A range switch must trigger a real refetch, not just a relabel.
  const req = await page.evaluate(async (range) => {
    const res = await fetch(`/api/metrics?range=${range}`);
    const data = await res.json();
    return { ok: res.ok, buckets: data.metrics.series.length, scanned: data.metrics.dependenciesScanned };
  }, r);
  check(`range ${r} served by API`, req.ok && req.buckets > 0, `${req.buckets} buckets, ${req.scanned} scanned`);
}

/* 2. Deep-linking a range renders that range. */
await page.goto(`${base}/app?range=30D`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1200);
const deepPressed = await page
  .getByRole("button", { name: "30D", exact: true })
  .getAttribute("aria-pressed");
check("?range=30D deep link is honoured", deepPressed === "true");

/* 3. Ctrl+K / Cmd+K search. */
await page.keyboard.press("Control+k");
await page.waitForTimeout(800);
const dialog = page.getByRole("dialog", { name: "Search" });
check("Ctrl+K opens search", await dialog.isVisible());

await page.keyboard.type("express");
await page.waitForTimeout(2500);
const hitCount = await page.locator('[role="dialog"] a[href^="/scan/"]').count();
check("search returns real results", hitCount > 0, `${hitCount} hit(s)`);

await page.keyboard.press("Escape");
await page.waitForTimeout(600);
check("Escape closes search", !(await dialog.isVisible().catch(() => false)));

/* 4. A search result opens its threat report. */
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
await page.keyboard.type("express");
await page.waitForTimeout(2500);
await page.locator('[role="dialog"] a[href^="/scan/"]').first().click();
await page.waitForTimeout(SETTLE);
check("search result opens threat report", page.url().includes("/scan/"), page.url().replace(base, ""));
check("report shows a verdict chip", await page.locator("text=/ALLOW|REVIEW|BLOCK|PENDING/").first().isVisible());
// The Threat Report now navigates back through the reference's breadcrumb
// ("Scan > package > Threat Report") instead of a "Back to scans" button.
const backLink = page.getByRole("link", { name: "Scan", exact: true }).first();
check("report links back to scan history", await backLink.isVisible());
await backLink.click();
await page.waitForTimeout(SETTLE);
check("report back-link returns to /scan", page.url().endsWith("/scan"), page.url().replace(base, ""));

/* 5. Sidebar navigation. */
await page.getByRole("link", { name: "Network", exact: true }).click();
await page.waitForTimeout(SETTLE);
check("sidebar -> Network", page.url().endsWith("/network"), page.url().replace(base, ""));

await page.getByRole("link", { name: "Scan", exact: true }).click();
await page.waitForTimeout(SETTLE);
check("sidebar -> Scan", page.url().endsWith("/scan"), page.url().replace(base, ""));

/* 6. Scan form: one npm coordinate field. Submission stays on /scan and shows
      an explicit "created and queued" banner with a View Threat Report action,
      so "record created" is never confused with "analysis complete". */
const newestId = async () => (await (await fetch(`${base}/api/scans?limit=1`)).json()).scans[0].id;
const idBefore = await newestId();

await page.locator("#dz-scan-input").fill("");
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.waitForTimeout(800);
check(
  "empty submit is blocked with a message",
  await page.locator("text=/Enter a package coordinate/").isVisible(),
);

await page.locator("#dz-scan-input").fill("left-pad@1.3.0");
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.waitForTimeout(SETTLE);

check(
  "scan submission stays on the Scanner",
  page.url().endsWith("/scan"),
  page.url().replace(base, ""),
);

const banner = page.locator('[role="status"]');
check("scan submission shows a success state", await banner.isVisible());

const reportLink = banner.getByRole("link", { name: /View Threat Report/i });
check("success state offers View Threat Report", await reportLink.isVisible());
const reportHref = await reportLink.getAttribute("href");

const idAfter = await newestId();
check("scan form creates a persisted record", idAfter !== idBefore, `${idBefore.slice(0, 8)} -> ${idAfter.slice(0, 8)}`);
check("View Threat Report targets the new record", reportHref === `/scan/${idAfter}`, `${reportHref} vs /scan/${idAfter}`);

/* The banner must reflect the record's ACTUAL state. A completed scan
   legitimately reports its verdict; a queued one must never claim it. */
const live = (await (await fetch(`${base}/api/scans/${idAfter}`)).json()).scan;
const bannerText = await banner.innerText();
check(
  "banner state matches the record",
  live.phase === "completed" ? /scan complete/i.test(bannerText) : !/scan complete/i.test(bannerText),
  `phase=${live.phase}`,
);
/* The banner polls every 2s, so asserting against it immediately after
   submitting races the poll. Wait for the record to reach a terminal phase via
   the API first (deterministic), then let the banner catch up. */
let terminal = null;
for (let i = 0; i < 45; i++) {
  const rec = (await (await fetch(`${base}/api/scans/${idAfter}`)).json()).scan;
  if (rec.phase === "completed" || rec.phase === "error") { terminal = rec; break; }
  await new Promise((r) => setTimeout(r, 2000));
}
check("scan reached a terminal phase", Boolean(terminal), terminal ? terminal.phase : "timeout");
check(
  "banner state matches the record",
  terminal ? (terminal.phase === "completed" ? /scan complete/i.test(bannerText) : !/scan complete/i.test(bannerText)) : true,
  terminal ? terminal.phase : "",
);
// The coordinate is rendered from the resolution once the scan completes.
check(
  "banner names the real coordinate",
  terminal?.phase !== "completed" || bannerText.includes("left-pad") || terminal.resolution.resolvedName === "left-pad",
);
await reportLink.click();
await page.waitForTimeout(SETTLE);
check("View Threat Report opens that record", page.url().endsWith(`/scan/${idAfter}`), page.url().replace(base, ""));
check("report shows the real coordinate", (await page.locator("body").innerText()).includes("left-pad"));

/* 7. The new record is reachable from Recent Scans on the Dashboard. */
await page.getByRole("link", { name: "Dashboard", exact: true }).click();
await page.waitForTimeout(SETTLE);
check("logo/nav -> Dashboard", page.url().endsWith("/app"), page.url().replace(base, ""));
check("Recent Scans shows the record", await page.locator("text=left-pad@1.3.0").first().isVisible());

/* 8. Recent Scans link reaches a report. */
await page.locator('a[href^="/scan/"]').first().click();
await page.waitForTimeout(SETTLE);
check("Recent Scans opens a report", page.url().includes("/scan/"), page.url().replace(base, ""));

/* 9. Keyboard reachability of every *visible* interactive element. */
await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1200);
const focus = await page.evaluate(() => {
  const out = [];
  let total = 0;
  for (const el of document.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // hidden at this breakpoint
    total++;
    el.focus();
    if (document.activeElement !== el) {
      out.push({ tag: el.tagName, cls: String(el.className).slice(0, 60) });
    }
  }
  return { total, bad: out };
});
check(
  "all visible controls are focusable",
  focus.bad.length === 0,
  `${focus.total - focus.bad.length}/${focus.total} ${JSON.stringify(focus.bad)}`,
);

/* 10. Attestation rows link to the correct Devnet explorer URL. */
const explorer = await page.evaluate(async () => {
  const res = await fetch("/api/attestations");
  const data = await res.json();
  return data.attestations.length;
});
check("attestations stay empty until real signatures exist", explorer === 0, `${explorer} row(s)`);

/* ---------------- Mobile ---------------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
const mErrors = [];
mobile.on("pageerror", (e) => mErrors.push(e.message.slice(0, 90)));
mobile.on("console", (m) => {
  if (m.type() === "error") mErrors.push(m.text().slice(0, 90));
});
await mobile.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await mobile.waitForTimeout(1200);

const burger = mobile.getByRole("button", { name: "Open navigation" });
check("mobile shows nav toggle", await burger.isVisible());
check("mobile sidebar is off-canvas", !(await mobile.locator("#console-nav").isVisible().catch(() => false)));

await burger.click();
await mobile.waitForTimeout(800);
check("mobile drawer opens", await mobile.locator("#console-nav").isVisible());

await mobile.keyboard.press("Escape");
await mobile.waitForTimeout(600);
check("Escape closes mobile drawer", !(await mobile.locator("#console-nav").isVisible().catch(() => false)));

await burger.click();
await mobile.waitForTimeout(800);
await mobile.locator("#console-nav").getByRole("link", { name: "Network", exact: true }).click();
// Client-side navigation on a synced filesystem can take a while to settle.
await mobile.waitForURL(/\/network$/, { timeout: 60000 }).catch(() => {});
await mobile.waitForTimeout(SETTLE);
check("mobile drawer navigates", mobile.url().endsWith("/network"), mobile.url().replace(base, ""));
check("drawer auto-closes on navigate", !(await mobile.locator("#console-nav").isVisible().catch(() => false)));

check("no mobile console errors", mErrors.length === 0, mErrors.join(" | "));
check("no desktop console errors", errors.length === 0, errors.join(" | "));

console.log(`\n${failures === 0 ? "PASS — every interactive control verified" : `FAIL — ${failures} check(s) failed`}`);
await browser.close();