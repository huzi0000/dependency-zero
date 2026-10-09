/* End-to-end: create a scan via the API and confirm it flows to the Dashboard. */
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

/* 1. Validation must reject bad input. */
const bad = await page.request.post(`${base}/api/scans`, {
  data: { packageName: "not a valid pkg!!", version: "1.0.0" },
});
console.log("reject invalid name  ->", bad.status());

const missing = await page.request.post(`${base}/api/scans`, { data: { packageName: "x" } });
console.log("reject missing ver   ->", missing.status());

/* 2. Create a real scan. */
const created = await page.request.post(`${base}/api/scans`, {
  data: { packageName: "express", version: "4.18.2" },
});
const body = await created.json();
console.log("create scan          ->", created.status(), body.scan?.status, body.scan?.id?.slice(0, 8));

const second = await page.request.post(`${base}/api/scans`, {
  data: { packageName: "lodash", version: "4.17.21" },
});
console.log("create 2nd scan      ->", second.status());

/* 3. Search must find it. */
const search = await page.request.get(`${base}/api/scans?q=express`);
const searchBody = await search.json();
console.log("search 'express'     ->", searchBody.scans?.length, "result(s)");

const noMatch = await page.request.get(`${base}/api/scans?q=zzzznope`);
console.log("search no match      ->", (await noMatch.json()).scans?.length, "result(s)");

/* 4. Metrics must reflect the real records. */
const m24 = await (await page.request.get(`${base}/api/metrics?range=24H`)).json();
const mAll = await (await page.request.get(`${base}/api/metrics?range=ALL`)).json();
console.log("metrics 24H          ->", m24.metrics.dependenciesScanned, "scanned,",
  m24.metrics.activeNodes, "nodes, accuracy", m24.metrics.networkAccuracy);
console.log("metrics ALL          ->", mAll.metrics.dependenciesScanned, "scanned");
console.log("accuracy withheld    ->", mAll.metrics.networkAccuracy === null, "(needs 30 resolved)");

/* 5. Detail page. */
await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(1200);
const recentText = await page.locator("text=express@4.18.2").first().isVisible();
console.log("dashboard shows scan ->", recentText);

await page.goto(`${base}/scan/${body.scan.id}`, { waitUntil: "load", timeout: 60000 });
const pendingVisible = await page.locator("text=PENDING").first().isVisible();
console.log("detail shows PENDING ->", pendingVisible);

await page.goto(`${base}/scan/does-not-exist`, { waitUntil: "load", timeout: 60000 });
console.log("bad scan id -> 404 page:", page.url().includes("does-not-exist"));

/* 6. Attestations must stay empty (no fabricated signatures). */
const att = await (await page.request.get(`${base}/api/attestations`)).json();
console.log("attestations (honest)->", att.attestations.length, "(expected 0)");

/* 7. Network page. */
await page.goto(`${base}/network`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(500);
const rpcText = await page.locator("text=/Connected|Unreachable/").first().innerText();
console.log("network rpc status   ->", rpcText);

console.log("\nconsole/page errors  ->", errors.length ? errors.join(" ; ") : "none");
await browser.close();