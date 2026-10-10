/* Cross-page flow verification for the three rebuilt pages.
   Guards navigation, the real scan submission path, honest empty states,
   responsive overflow and console cleanliness. */
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 80)}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) {
    errors.push(`console: ${m.text().slice(0, 80)}`);
  }
});

/* ---- 1. Dashboard -> Scanner ---- */
await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
await page.getByRole("link", { name: "Scan", exact: true }).click();
await page.waitForTimeout(2500);
check("Dashboard -> Scanner", page.url().endsWith("/scan"), page.url().replace(base, ""));
check("Scanner heading", (await page.locator("h1").first().innerText()).trim() === "Scan Dependency");

/* ---- 2. Scanner structure vs reference ---- */
check("Scanner has 4 tabs", (await page.locator("[role=tab]").count()) === 4, `${await page.locator("[role=tab]").count()}`);
check("Scanner right rail: How it works", await page.getByRole("heading", { name: "How it works" }).isVisible());
check("Scanner right rail: Supported Sources", await page.getByRole("heading", { name: "Supported Sources" }).isVisible());
check("Scanner right rail: Real-time Analysis", await page.getByRole("heading", { name: "Real-time Analysis" }).isVisible());
check("Scanner Recent Scans table", await page.getByRole("heading", { name: "Recent Scans" }).isVisible());
// Column headers are uppercased by CSS, so compare case-insensitively. The
// trailing sr-only "Open" header exists for the chevron link's a11y and is
// filtered out.
const scanHeaders = (await page.locator("table thead th").allInnerTexts())
  .map((t) => t.trim().replace(/\s+/g, " ").toLowerCase())
  .filter((t) => t && t !== "open");
check(
  "Recent Scans columns match reference",
  scanHeaders.join(",") === "package,version,verdict,risk score,time",
  scanHeaders.join(","),
);

/* ---- 3. Unavailable tabs are honest, not fake ---- */
await page.getByRole("tab", { name: "Batch Scan" }).isDisabled().catch(() => {});
check("Batch Scan tab is disabled (honest)", await page.getByRole("tab", { name: "Batch Scan" }).isDisabled());
check("CLI Command tab is disabled (honest)", await page.getByRole("tab", { name: "CLI Command" }).isDisabled());

/* ---- 4. Example pill prefills the real input ---- */
const pills = page.locator(".dz-pill");
const pillCount = await pills.count();
check("Example pills present", pillCount === 4, `${pillCount}`);
if (pillCount > 0) {
  const pillText = (await pills.first().innerText()).trim();
  await pills.first().click();
  await page.waitForTimeout(400);
  const inputValue = await page.locator("#dz-scan-input").inputValue();
  check("Example pill prefills the input", inputValue === pillText, `"${inputValue}" vs "${pillText}"`);
}

/* ---- 5. Real scan submission -> queued banner -> Threat Report ----
   Submission deliberately stays on the Scanner and surfaces a "created and
   queued" banner; the report is reached through its View Threat Report action. */
await page.locator("#dz-scan-input").fill("vite@5.4.11");
await page.getByRole("button", { name: /^Scan$/ }).click();
await page.waitForTimeout(3500);
const banner = page.locator('[role="status"]');
check("submit shows a queued success state", await banner.isVisible());
const reportHref = await banner.getByRole("link", { name: /View Threat Report/i }).getAttribute("href");
check("queued banner links to a real report", /^\/scan\/[0-9a-f-]{36}$/.test(reportHref ?? ""), reportHref ?? "none");
await banner.getByRole("link", { name: /View Threat Report/i }).click();
await page.waitForTimeout(3000);
const onReport = /\/scan\/[0-9a-f-]{36}/.test(page.url());
check("View Threat Report opens the Threat Report", onReport, page.url().replace(base, ""));

if (onReport) {
  const body = await page.locator("body").innerText();
  check("Report shows real package + version", body.includes("vite") && body.includes("5.4.11"));
  // A completed scan shows its REAL verdict; an unresolved one shows PENDING.
// Either is honest, so assert it matches the record's actual phase.
const rec = (await (await fetch(`${base}/api/scans/${page.url().split("/").pop()}`)).json()).scan;
check(
  "Report verdict matches the stored record",
  rec.phase === "completed"
    ? body.includes(rec.resolution.verdict.toUpperCase())
    : rec.phase === "error"
      ? body.includes("ERROR") || body.includes("Scan failed")
      : body.includes("PENDING"),
  `phase=${rec.phase}`,
);
  check("Report says not yet attested", body.includes("Not yet attested on Solana Devnet"));
  check("Report shows no fabricated risk score", body.includes("—"), "em dash present");
  check("Report has the 5 reference tabs", (await page.locator("[role=tab]").count()) === 5, `${await page.locator("[role=tab]").count()}`);
  check("Report has Package Information", await page.getByRole("heading", { name: "Package Information" }).isVisible());
  check("Report has Scanner Consensus", await page.getByRole("heading", { name: "Scanner Consensus" }).isVisible());
  check("Report has Key Threats", await page.getByRole("heading", { name: "Key Threats" }).isVisible());
  check("Report has Dependency Graph", await page.getByRole("heading", { name: "Dependency Graph" }).isVisible());
  check("Report has Scan Result", await page.getByRole("heading", { name: "Scan Result" }).isVisible());

  /* ---- 6. Report tabs switch to honest placeholders ---- */
  await page.getByRole("tab", { name: /On-chain Proof/ }).click();
  await page.waitForTimeout(500);
  check("On-chain Proof tab is honest", (await page.locator("body").innerText()).includes("Not yet attested"));
  await page.getByRole("tab", { name: /Network Verdicts/ }).click();
  await page.waitForTimeout(500);
  check("Network Verdicts tab is honest", (await page.locator("body").innerText()).includes("No node verdicts"));
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.waitForTimeout(500);

  /* ---- 7. Back to Scanner ---- */
  await page.getByRole("link", { name: "Scan", exact: true }).first().click();
  await page.waitForTimeout(2000);
  check("breadcrumb -> Scanner", page.url().endsWith("/scan"));

  /* ---- 8. Report appears in history (persistence intact) ---- */
  check("new scan persisted in history", (await page.locator("body").innerText()).includes("vite"));
}

/* ---- 9. Missing scan ID -> 404 ---- */
const resp = await page.goto(`${base}/scan/00000000-0000-0000-0000-000000000000`, { waitUntil: "load", timeout: 60000 });
check("missing scan id returns 404", resp?.status() === 404, `status ${resp?.status()}`);

/* ---- 10. Sidebar -> Network ---- */
await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1500);
await page.getByRole("link", { name: "Network", exact: true }).click();
await page.waitForTimeout(2500);
check("Sidebar -> Network", page.url().endsWith("/network"), page.url().replace(base, ""));
check("Network heading", (await page.locator("h1").first().innerText()).trim() === "Scanner Network");
check("Network shows eyebrow", (await page.locator("body").innerText()).includes("NETWORK"));
check("Network shows live Devnet status", (await page.locator("body").innerText()).includes("Solana Devnet"));
check("Network reports 0 nodes honestly", (await page.locator("body").innerText()).includes("0 scanner nodes registered"));
check("Network says program not deployed", (await page.locator("body").innerText()).includes("Not deployed"));
check("Network has Scanner Nodes section", await page.getByRole("heading", { name: "Scanner Nodes" }).isVisible());
check("Network has Latest Consensus Activity", await page.getByRole("heading", { name: "Latest Consensus Activity" }).isVisible());
check("Network has Recent On-chain Attestations", await page.getByRole("heading", { name: "Recent On-chain Attestations" }).isVisible());

/* ---- 11. Network -> Dashboard ---- */
await page.getByRole("link", { name: "Dashboard", exact: true }).click();
await page.waitForTimeout(2000);
check("Network -> Dashboard", page.url().endsWith("/app"));

/* ---- 12. Wallet chip still present and working ---- */
check("wallet chip renders", await page.locator(".dz-scroll button[aria-haspopup=menu]").first().isVisible());
await page.locator(".dz-scroll button[aria-haspopup=menu]").first().click();
await page.waitForTimeout(600);
check("wallet menu opens", (await page.locator("[role=menu]").count()) > 0);
await page.keyboard.press("Escape");

/* ---- 13. Responsive overflow across all three pages ----
   Measured as *actual* horizontal scrollability, not scrollWidth. The Recent
   Scans table has a deliberate 720px min-width inside its own `overflow-x:auto`
   scroller, so scrollWidth legitimately exceeds the viewport there while the
   page itself still cannot be panned sideways. */
const canScrollX = () => {
  window.scrollTo(600, 0);
  const x = window.scrollX;
  window.scrollTo(0, 0);
  return x;
};

const id = (await (await fetch(`${base}/api/scans?limit=1`)).json()).scans[0].id;

for (const width of [1536, 1440, 1280, 1024, 768, 390, 360]) {
  const p = await browser.newPage({ viewport: { width, height: 1000 } });
  for (const route of ["/scan", "/network", `/scan/${id}`]) {
    await p.goto(`${base}${route}`, { waitUntil: "load", timeout: 120000 });
    await p.waitForTimeout(1200);
    const x = await p.evaluate(canScrollX);
    check(`${route} @ ${width}px no page h-scroll`, x === 0, `scrollX=${x}`);
  }
  await p.close();
}

check("no console errors during flows", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`\n${failures === 0 ? "PASS — all three pages verified" : `FAIL — ${failures} check(s) failed`}`);
await browser.close();
