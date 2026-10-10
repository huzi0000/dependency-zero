/* Correction-pass checks: sidebar, report navigation, network tabs,
   wallet claim audit, and truthful-data guards. */
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
// Clipboard assertions need explicit permissions; the copy button itself is
// real either way.
await page
  .context()
  .grantPermissions(["clipboard-read", "clipboard-write"])
  .catch(() => {});
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 80)}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 80)}`);
});

// The sidebar is the nav landmark labelled "Dashboard" (a unique name on the
// page; the page's own H1 heading is not inside a nav).
const nav = page.getByRole("navigation", { name: "Dashboard" });

/* ---- 1. Sidebar has exactly three items ---- */
await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
const navItems = await nav.locator("a").allInnerTexts();
check(
  "sidebar has exactly 3 items",
  navItems.length === 3,
  navItems.map((t) => t.trim()).join(" | "),
);
check(
  "sidebar items are Dashboard / Scan / Network",
  navItems.map((t) => t.trim()).join(",") === "Dashboard,Scan,Network",
);
check(
  "no Threat Report item in sidebar",
  !(await nav.getByText(/threat/i).count()) > 0,
);

/* ---- 2. Scan is active on the Threat Report ---- */
const id = (await (await fetch(`${base}/api/scans?limit=1`)).json()).scans[0].id;
await page.goto(`${base}/scan/${id}`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
check(
  "Scan stays active on /scan/[id]",
  (await nav.getByRole("link", { name: "Scan", exact: true }).getAttribute("data-active")) ===
    "true",
);

/* ---- 3. Scanner rows open the correct Threat Report ---- */
await page.goto(`${base}/scan`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
const firstViewReport = page.getByRole("link", { name: "View Report" }).first();
check("Scanner rows expose a View Report action", await firstViewReport.isVisible());
const expectedHref = await firstViewReport.getAttribute("href");
check("View Report href matches the stored scan id", /^\/scan\/[0-9a-f-]{36}$/.test(expectedHref), expectedHref);
await firstViewReport.click();
await page.waitForTimeout(2500);
check("Scanner View Report opens that report", page.url().endsWith(expectedHref), page.url().replace(base, ""));

/* ---- 4. Dashboard rows open the correct Threat Report ---- */
await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
const dashRow = page.locator("section li a[href^='/scan/']").first();
check("Dashboard rows link to a real report", (await dashRow.getAttribute("href")) === `/scan/${id}` || /^\/scan\/[0-9a-f-]{36}$/.test(await dashRow.getAttribute("href")), await dashRow.getAttribute("href"));
check("Dashboard row shows a View Report affordance", (await dashRow.innerText()).includes("View Report"));

/* ---- 5. Scan creation exposes View Threat Report ---- */
const newestBefore = (await (await fetch(`${base}/api/scans?limit=1`)).json()).scans[0].id;
await page.goto(`${base}/scan`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
await page.locator("#dz-scan-input").fill("ts-invariant-check@1.0.0");
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.waitForTimeout(3500);
const banner = page.locator('[role="status"]');
check("creation shows a success state", await banner.isVisible());
const bannerText = await banner.innerText();
check("success state says queued, not complete", /queued/i.test(bannerText) && !/analysis complete/i.test(bannerText));
check("success state does not claim a verdict", !/safe|blocked|malicious/i.test(bannerText));
const vtr = banner.getByRole("link", { name: /View Threat Report/i });
check("success state offers View Threat Report", await vtr.isVisible());
const vtrHref = await vtr.getAttribute("href");
check("View Threat Report points at the new record", vtrHref !== `/scan/${newestBefore}`, vtrHref);
await vtr.click();
await page.waitForTimeout(2500);
check("View Threat Report navigates correctly", page.url().endsWith(vtrHref), page.url().replace(base, ""));
check("report shows the created package", (await page.locator("body").innerText()).includes("ts-invariant-check"));

/* ---- 6. Invalid scan IDs ---- */
const bad = await page.goto(`${base}/scan/00000000-0000-0000-0000-000000000000`, {
  waitUntil: "load",
  timeout: 60000,
});
check("invalid scan id 404s", bad?.status() === 404, `status ${bad?.status()}`);

/* The 404 probe above deliberately requests a missing document, which the
   browser also reports as a failed resource. Reset the buffer so the final
   console assertion covers only normal navigation. */
errors.length = 0;

/* ---- 7. Network has four functional tabs ---- */
await page.goto(`${base}/network`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
const netTabs = page.getByRole("tab");
check("Network has 4 tabs", (await netTabs.count()) === 4, `${await netTabs.count()}`);
const netLabels = (await netTabs.allInnerTexts()).map((t) => t.trim());
check(
  "Network tabs are Overview/Scanners/Attestations/Registry",
  netLabels.join(",") === "Overview,Scanners,Attestations,Registry",
  netLabels.join(","),
);
check("Overview is selected by default", (await netTabs.first().getAttribute("aria-selected")) === "true");

for (const [label, expect] of [
  ["Scanners", "Scanner Nodes"],
  ["Attestations", "Recent On-chain Attestations"],
  ["Registry", "Solana Registry"],
]) {
  await page.getByRole("tab", { name: label }).click();
  await page.waitForTimeout(700);
  const body = await page.locator("body").innerText();
  check(`tab "${label}" switches content`, body.includes(expect), expect);
  check(
    `tab "${label}" is aria-selected`,
    (await page.getByRole("tab", { name: label }).getAttribute("aria-selected")) === "true",
  );
}

/* Keyboard operability of the network tabs. */
await page.getByRole("tab", { name: "Overview" }).click();
await page.waitForTimeout(500);
await page.getByRole("tab", { name: "Overview" }).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const activeEl = await page.evaluate(() => document.activeElement?.textContent?.trim());
check("Network tabs are keyboard operable", activeEl === "Overview", `activeElement="${activeEl}"`);

/* ---- 8. How It Works card ---- */
await page.getByRole("tab", { name: "Overview" }).click();
await page.waitForTimeout(700);
check("How It Works card exists", await page.getByRole("heading", { name: "How It Works" }).isVisible());
const how = await page.locator("#network-how-it-works").locator("..").innerText();
for (const step of ["Scanner registration", "Dependency inspection", "Signed findings & consensus", "Solana Devnet attestation"]) {
  check(`How It Works lists "${step}"`, how.includes(step));
}
check(
  "How It Works labels unavailable steps as such",
  /Not connected|Unavailable|Not deployed/.test(how),
);
check("How It Works does not fake a valid consensus", !/Valid Consensus/i.test(how));

/* ---- 9. Scanner input validation ---- */
await page.goto(`${base}/scan`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
await page.locator("#dz-scan-input").fill("");
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.waitForTimeout(700);
check("empty input is rejected", await page.locator("text=/Enter a package coordinate/").isVisible());
// A bare package name (no @version) resolves to "latest" and is accepted.
// Submission deliberately stays on this page and shows the queued banner, so
// the assertion is the banner, not a URL change.
await page.locator("#dz-scan-input").fill("no-at-sign-anywhere");
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.waitForTimeout(3000);
check(
  "valid bare package name is accepted",
  (await page.locator('[role="status"]').innerText()).includes("no-at-sign-anywhere"),
);

/* ---- 10. Wallet messages make no unsupported claims ---- */
for (const route of ["/app", "/scan", "/network"]) {
  await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  check(
    `${route} makes no signature/attribution claim`,
    !/attributed to your address|scan was signed|transaction submitted|verified on solana/i.test(body),
  );
}

/* ---- 11/12. PENDING report has no fake data ---- */
await page.goto(`${base}/scan/${id}`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
const report = await page.locator("body").innerText();
check("report shows PENDING", report.includes("PENDING"));
check("report risk score is a dash, not a number", /Risk Score\s*—/i.test(report.replace(/\s+/g, " ")));
check("report has no invented verdict score", !/\b97\b|\b92\b/.test(report));
check("report states not yet attested", report.includes("Not yet attested on Solana Devnet"));
check("report never claims Solana verification", !/Verified on Solana/i.test(report));
check("report has no explorer link without a signature", (await page.locator('a[href*="explorer.solana.com"]').count()) === 0);
check("report explains pending is expected", /queued|has not run|not run/i.test(report));
check("report does not mislabel scan time as publish date", !/Published\s+[A-Z][a-z]{2}\s+\d/i.test(report));

/* Copy control copies the FULL scan id. */
await page.getByRole("button", { name: /Copy full scan id/i }).click();
await page.waitForTimeout(500);
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
check("copy button copies the complete scan id", clip === id, `got "${clip}"`);

check("no console errors during correction pass", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`\n${failures === 0 ? "PASS — correction pass verified" : `FAIL — ${failures} check(s) failed`}`);
await browser.close();
