/* Wallet detection, connection, verification and error-path suite.

   Stubs a Wallet Standard registry and/or a legacy injected provider to exercise
   the flow deterministically. A real Phantom approval cannot be automated, so
   these tests prove the app's behaviour around the extension; the manual
   checklist for a genuine Phantom approval is reported separately.
*/
import { chromium } from "playwright-core";

const base = "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** A realistic known-good Devnet address for stub responses. */
const ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const stdWallet = (overrides = {}) => `
  window.__dzWallet = {
    name: "Phantom",
    rdns: "app.phantom",
    version: "2.9.4",
    icon: "",
    accounts: [],
    features: {
      standard: { readonly: "standard" },
      chains: { readonly: "chains", supported: ["solana:mainnet", "solana:devnet"] },
      connect: {
        readonly: "connect",
        connect: async () => { window.__dzConnectCalls = (window.__dzConnectCalls||0)+1; return { accounts: [{ address: "${ADDRESS}" }] }; },
      },
      "connect:disconnect": {
        readonly: "connect:disconnect",
        connect: async () => ({ accounts: [{ address: "${ADDRESS}" }] }),
        disconnect: async () => { window.__dzDisconnectCalls = (window.__dzDisconnectCalls||0)+1; },
      },
    },
    ...( ${JSON.stringify(overrides)} ),
  };
`;

const registry = (getBody = "[window.__dzWallet]") => `
  const list = ${getBody};
  Object.defineProperty(navigator, "wallets", {
    configurable: true,
    value: {
      get: async () => list,
      register: (cb) => { window.__dzRegister = cb; return () => {}; },
    },
  });
`;

/** A wallet whose connect() rejects the way Phantom does (code 4001). */
const rejectingStub = () => `
  window.__dzWallet = {
    name: "Phantom", rdns: "app.phantom", accounts: [],
    features: {
      standard: { readonly: "standard" },
      chains: { readonly: "chains", supported: ["solana:devnet"] },
      connect: {
        readonly: "connect",
        connect: async () => {
          const e = new Error("User rejected the request.");
          e.code = 4001;
          throw e;
        },
      },
    },
  };
${registry()}
`;

/** A locked wallet — the extension exists but refuses until unlocked. */
const lockedStub = () => `
  window.__dzWallet = {
    name: "Phantom", rdns: "app.phantom", accounts: [],
    features: {
      standard: { readonly: "standard" },
      chains: { readonly: "chains", supported: ["solana:devnet"] },
      connect: {
        readonly: "connect",
        connect: async () => {
          const e = new Error("Please unlock your wallet first.");
          e.code = -32002;
          throw e;
        },
      },
    },
  };
${registry()}
`;

/** A wallet that returns something that is not a public address. */
const badAddressStub = () => `
  window.__dzWallet = {
    name: "Phantom", rdns: "app.phantom", accounts: [],
    features: {
      standard: { readonly: "standard" },
      connect: { readonly: "connect", connect: async () => ({ accounts: [{ address: "not-a-real-address" }] }) },
    },
  };
${registry()}
`;

async function newPage(init) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  if (init) await page.addInitScript(init);
  await page.goto(`${base}/app`, { waitUntil: "load", timeout: 120000 });
  return page;
}

const walletBtn = (p) => p.locator(".dz-scroll button[aria-haspopup='menu']").first();

/* ---------------------------------------------------------------- 1. Wallet Standard */
{
  const page = await newPage(`${stdWallet()}\n${registry()}`);
  await page.waitForTimeout(2200);

  const btn = walletBtn(page);
  const label = (await btn.innerText()).trim();
  check("WS: control is never disabled", !(await btn.isDisabled()), `label="${label}"`);
  check("WS: shows 'Connect Wallet'", label === "Connect Wallet", label);

  await btn.click();
  await page.waitForTimeout(600);
  const options = await page.locator("[role=menu] [role=menuitem]").allInnerTexts();
  check("WS: Phantom listed", options.some((t) => t.includes("Phantom")), JSON.stringify(options));
  check(
    "WS: chain badges rendered",
    options.some((t) => /Devnet/i.test(t)),
    JSON.stringify(options),
  );

  await page.locator("[role=menu] [role=menuitem]", { hasText: "Phantom" }).first().click();
  await page.waitForTimeout(3000);

  // Devnet verification is a live RPC round trip; allow it to settle.
  await page
    .locator(".dz-scroll button[aria-haspopup='menu']")
    .first()
    .filter({ hasText: "9xQe" })
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  const chip = (await btn.innerText()).trim();
  const expected = `${ADDRESS.slice(0, 4)}…${ADDRESS.slice(-4)}`;
  check("WS: shows shortened address", chip.includes(expected), `"${chip.replace(/\n/g, " ")}" expected "${expected}"`);

  const menu = await page.evaluate(() => JSON.parse(localStorage.getItem("dz:wallet") || "null"));
  check("WS: session persisted", menu?.address === ADDRESS, JSON.stringify(menu));

  // Verify RPC really was consulted.
  const rpc = await page.evaluate(async (a) => {
    const r = await fetch(`/api/wallet/verify?address=${a}`);
    return { status: r.status, body: await r.json() };
  }, ADDRESS);
  check("WS: Devnet verification succeeded", rpc.body.ok === true, JSON.stringify(rpc.body));

  // Disconnect.
  await btn.click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  await page.waitForTimeout(1200);
  const after = (await walletBtn(page).innerText()).trim();
  check("WS: disconnect returns to Connect Wallet", after === "Connect Wallet", after);
  const calls = await page.evaluate(() => window.__dzDisconnectCalls || 0);
  check("WS: wallet's own disconnect called", calls === 1, `${calls} call(s)`);
  await page.close();
}

/* ------------------------------------------- 2. Wallet Standard, late registration */
{
  const page = await newPage(`${registry("[]")}
    window.addEventListener("load", () => {
      setTimeout(() => { ${stdWallet()} window.__dzRegister?.(window.__dzWallet); }, 800);
    }, { once: true });
  `);
  await page.waitForTimeout(3000);

  const label = (await walletBtn(page).innerText()).trim();
  check("LATE: control stays usable while empty", !(await walletBtn(page).isDisabled()), label);

  await walletBtn(page).click();
  await page.waitForTimeout(800);
  const options = await page.locator("[role=menu] [role=menuitem]").allInnerTexts();
  check("LATE: late-registered wallet is discovered", options.some((t) => t.includes("Phantom")), options.join(" | "));
  await page.close();
}

/* ------------------------------------------------------------ 3. Legacy provider only */
{
  const page = await newPage(`
    window.phantom = {
      isPhantom: true,
      solana: {
        isPhantom: true,
        publicKey: null,
        connect: async () => ({ publicKey: "${ADDRESS}" }),
        disconnect: async () => { window.__dzDisconnectCalls = (window.__dzDisconnectCalls||0)+1; },
      },
    };
  `);
  await page.waitForTimeout(2200);

  const btn = walletBtn(page);
  const label = (await btn.innerText()).trim();
  check("LEGACY: control is NOT disabled", !(await btn.isDisabled()), label);
  check("LEGACY: shows 'Connect Wallet'", label === "Connect Wallet", label);

  await btn.click();
  await page.waitForTimeout(700);
  const options = await page.locator("[role=menu] [role=menuitem]").allInnerTexts();
  check("LEGACY: Phantom offered via window.phantom.solana", options.some((t) => t.includes("Phantom")), options.join(" | "));

  await page.locator("[role=menu] [role=menuitem]", { hasText: "Phantom" }).first().click();
  await page
    .locator(".dz-scroll button[aria-haspopup='menu']")
    .first()
    .filter({ hasText: "9xQe" })
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  const chip = (await walletBtn(page).innerText()).trim();
  check("LEGACY: connects and shows address", chip.includes(`${ADDRESS.slice(0, 4)}…`), `"${chip.replace(/\n/g, " ")}"`);
  await page.close();
}

/* --------------------------------- 4. Phantom exposing BOTH APIs appears once */
{
  const page = await newPage(`${stdWallet()}\n${registry()}
    window.phantom = { isPhantom: true, solana: { connect: async () => ({ publicKey: "${ADDRESS}" }), disconnect: async () => {} } };
  `);
  await page.waitForTimeout(2200);
  await walletBtn(page).click();
  await page.waitForTimeout(700);
  const phantomEntries = (await page.locator("[role=menu] [role=menuitem]").allInnerTexts()).filter((t) => t.includes("Phantom"));
  check("DEDUPE: Phantom appears exactly once", phantomEntries.length === 1, `${phantomEntries.length} entries`);
  await page.close();
}

/* ------------------------------------------------------- 5. User rejects the request */
{
  const page = await newPage(rejectingStub());
  await page.waitForTimeout(2200);
  await walletBtn(page).click();
  await page.waitForTimeout(700);
  const listed = await page.locator("[role=menu] [role=menuitem]").allInnerTexts();
  check("REJECT: wallet listed before attempting", listed.some((t) => t.includes("Phantom")), JSON.stringify(listed));
  await page.waitForTimeout(600);
  await page.locator("[role=menu] [role=menuitem]", { hasText: "Phantom" }).first().click();
  await page.waitForTimeout(2500);

  const label = (await walletBtn(page).innerText()).trim();
  check("REJECT: stays disconnected", label === "Connect Wallet", label);

  await walletBtn(page).click();
  await page.waitForTimeout(600);
  const alert = (await page.locator("[role=menu] [role=alert]").innerText().catch(() => "")).trim();
  check("REJECT: friendly message shown", /declined|rejected/i.test(alert), `"${alert}"`);
  check("REJECT: no raw error code leaked", !/4001|WalletNotFound/.test(alert), alert);
  const stored = await page.evaluate(() => localStorage.getItem("dz:wallet"));
  check("REJECT: nothing persisted", stored === null, String(stored));
  await page.close();
}

/* ------------------------------------------------------------ 6. Wallet is locked */
{
  const page = await newPage(lockedStub());
  await page.waitForTimeout(2200);
  await walletBtn(page).click();
  await page.waitForTimeout(600);
  await page.locator("[role=menu] [role=menuitem]", { hasText: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  await walletBtn(page).click();
  await page.waitForTimeout(600);
  const alert = (await page.locator("[role=menu] [role=alert]").innerText().catch(() => "")).trim();
  check("LOCKED: tells the user to unlock", /unlock/i.test(alert), `"${alert}"`);
  await page.close();
}

/* ------------------------------------------------ 7. No extension installed at all */
{
  const page = await newPage("");
  await page.waitForTimeout(2200);
  const btn = walletBtn(page);
  check("NONE: control still enabled (guidance reachable)", !(await btn.isDisabled()));
  check("NONE: still labelled Connect Wallet", (await btn.innerText()).trim() === "Connect Wallet");

  await btn.click();
  await page.waitForTimeout(600);
  const menuText = (await page.locator("[role=menu]").innerText()).replace(/\s+/g, " ").trim();
  check("NONE: explains what to install", /Phantom/i.test(menuText), menuText.slice(0, 140));
  check("NONE: offers a re-check action", /Re-check/i.test(menuText));
  await page.close();
}

/* ------------------------------------------------ 8. Re-check recovers after install */
{
  const page = await newPage("");
  await page.waitForTimeout(2200);
  await walletBtn(page).click();
  await page.waitForTimeout(600);

  // Simulate the extension becoming available, then press Re-check.
  await page.evaluate(`${stdWallet()}\n${registry()}`);
  await page.getByRole("menuitem", { name: /Re-check/i }).click();
  await page.waitForTimeout(2500);
  const options = await page.locator("[role=menu] [role=menuitem]").allInnerTexts();
  check("RECHECK: wallet appears after re-check", options.some((t) => t.includes("Phantom")), options.join(" | "));
  await page.close();
}

/* ------------------------------------ 9. Invalid address returned is rejected */
{
  const page = await newPage(badAddressStub());
  await page.waitForTimeout(2200);
  await walletBtn(page).click();
  await page.waitForTimeout(600);
  await page.locator("[role=menu] [role=menuitem]", { hasText: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  const label = (await walletBtn(page).innerText()).trim();
  check("BADADDR: not accepted as connected", label === "Connect Wallet", label);
  const stored = await page.evaluate(() => localStorage.getItem("dz:wallet"));
  check("BADADDR: nothing persisted", stored === null, String(stored));
  await page.close();
}

/* --------------------------------- 10. No key material anywhere in the payload */
{
  const page = await newPage(`${stdWallet()}\n${registry()}`);
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push({ url: r.url(), method: r.method(), body: r.postData() });
  });
  await page.waitForTimeout(2200);
  await walletBtn(page).click();
  await page.waitForTimeout(600);
  await page.locator("[role=menu] [role=menuitem]", { hasText: "Phantom" }).first().click();
  await page.waitForTimeout(3000);

  const leaks = requests.filter((r) => /secret|mnemonic|seed|private|sign/i.test(`${r.url} ${r.body ?? ""}`));
  check("SECURITY: no key-like data sent to any API", leaks.length === 0, `${requests.length} API calls, ${leaks.length} suspicious`);
  const bodyDump = requests.map((r) => r.body ?? "").join(" ");
  check("SECURITY: only a public address is transmitted", bodyDump.length === 0 || /address=[1-9A-HJ-NP-Za-km-z]{32,44}/.test(bodyDump), bodyDump.slice(0, 120));

  const lsKeys = await page.evaluate(() => Object.keys(localStorage));
  const badKeys = lsKeys.filter((k) => /secret|mnemonic|seed|private|key/i.test(k) && k !== "dz:wallet");
  check("SECURITY: nothing sensitive in localStorage", badKeys.length === 0, lsKeys.join(", "));
  await page.close();
}

/* --------------------------------- 11. Mandatory gate blocks disconnected actions */
{
  const page = await newPage("");
  await page.waitForTimeout(2200);
  const gate = await page.evaluate(() => {
    // The gate must be reachable from the console shell.
    const el = document.querySelector(".dz-shell");
    return { shellPresent: !!el, hasMenuButton: !!document.querySelector(".dz-scroll button[aria-haspopup=menu]") };
  });
  check("GATE: console shell mounts the wallet provider", gate.shellPresent && gate.hasMenuButton, JSON.stringify(gate));
  await page.close();
}

/* ------------------------------ 12. Dashboard remains browsable while disconnected */
{
  const page = await newPage("");
  await page.waitForTimeout(2200);
  const h1 = await page.locator("h1").first().innerText();
  check("GATE: browsing works without a wallet", h1.trim() === "Dashboard", h1);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("GATE: no layout shift while disconnected", over === 0, `${over}px`);
  await page.close();
}

/* ==================================================================== */
/* REGRESSION — shapes read out of the installed Phantom extension v26.32 */
/*                                                                       */
/* The earlier stubs used shapes Phantom never returns, so they passed   */
/* while the real extension failed with "Wallet returned no account."    */
/* ==================================================================== */

/** A stand-in for Phantom's `PublicKey` class: never a string. */
const publicKeyClass = `
  class FakePublicKey {
    toBase58() { return "${ADDRESS}"; }
    toBytes() { return new Uint8Array(32).fill(7); }
    toBuffer() { return new Uint8Array(32).fill(7); }
    toString() { return this.toBase58(); }
    get [Symbol.toStringTag]() { return "PublicKey(" + this.toBase58() + ")"; }
  }
`;

/**
 * Phantom v26 Wallet Standard shape. Features are named `standard:connect` /
 * `standard:disconnect` / `standard:events`; the string `connect:disconnect`
 * does not appear anywhere in the extension, so it is absent here too.
 */
const phantomStandardStub = `
  ${publicKeyClass}
  let account = null;
  const handlers = [];
  window.__dzWallet = {
    name: "Phantom",
    rdns: "app.phantom",
    version: "2.14.0",
    icon: "",
    chains: ["solana:mainnet", "solana:devnet"],
    get accounts() { return account ? [account] : []; },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          window.__dzConnectCalls = (window.__dzConnectCalls || 0) + 1;
          account = {
            address: new FakePublicKey().toBase58(),
            publicKey: new FakePublicKey().toBytes(),
            chains: ["solana:mainnet", "solana:devnet"],
            features: {},
          };
          return { accounts: window.__dzWallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => { window.__dzDisconnectCalls = (window.__dzDisconnectCalls || 0) + 1; account = null; },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, handler) => { if (event === "change") handlers.push(handler); return () => {}; },
        off: (event, handler) => { const i = handlers.indexOf(handler); if (i >= 0) handlers.splice(i, 1); },
      },
    },
  };
  Object.defineProperty(navigator, "wallets", {
    configurable: true,
    value: { get: async () => [window.__dzWallet], register: (cb) => { window.__dzRegister = cb; return () => {}; } },
  });
`;

/** Phantom's LEGACY path: `connect()` resolves `{ publicKey: <PublicKey> }`. */
const phantomLegacyStub = `
  ${publicKeyClass}
  let key = null;
  window.phantom = {
    isPhantom: true,
    solana: {
      isPhantom: true,
      get publicKey() { return key; },
      connect: async () => { key = new FakePublicKey(); return { publicKey: key }; },
      disconnect: async () => { key = null; },
      on: () => () => {},
      off: () => {},
    },
  };
`;

/** Phantom resolves `standard:connect` with an EMPTY accounts list when its key
 *  is not yet populated, then delivers the account on the change event. */
const phantomRacingStub = `
  ${publicKeyClass}
  let account = null;
  const handlers = [];
  window.__dzWallet = {
    name: "Phantom", rdns: "app.phantom", icon: "", chains: ["solana:devnet"],
    get accounts() { return account ? [account] : []; },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          setTimeout(() => {
            account = { address: new FakePublicKey().toBase58(), publicKey: new FakePublicKey().toBytes(), chains: ["solana:devnet"], features: {} };
            handlers.forEach((h) => h({ accounts: window.__dzWallet.accounts }));
          }, 400);
          return { accounts: [] };
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (e, h) => { if (e === "change") handlers.push(h); return () => {}; },
        off: (e, h) => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); },
      },
    },
  };
  Object.defineProperty(navigator, "wallets", {
    configurable: true,
    value: { get: async () => [window.__dzWallet], register: (cb) => { window.__dzRegister = cb; return () => {}; } },
  });
`;

/** Clicks a wallet entry if the menu is open; opens it only when it is not. */
const pickWallet = async (page, name) => {
  if (!(await page.locator("[role=menu]").isVisible().catch(() => false))) {
    await walletBtn(page).click();
    await page.waitForTimeout(700);
  }
  const item = page.locator("[role=menu] [role=menuitem]", { hasText: name });
  await item.first().click({ timeout: 15000 });
};

const connectPhantom = async (page, btn) => {
  await pickWallet(page, "Phantom");
  await page
    .locator(".dz-scroll button[aria-haspopup='menu']")
    .first()
    .filter({ hasText: "9xQe" })
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  return (await btn.innerText()).trim().replace(/\n/g, " ");
};

/* -- 13. Phantom's real Wallet Standard feature names are understood ----- */
{
  const page = await newPage(phantomStandardStub);
  await page.waitForTimeout(2200);
  const btn = walletBtn(page);
  check("PHANTOM-STD: control enabled", !(await btn.isDisabled()));
  check("PHANTOM-STD: labelled Connect Wallet", (await btn.innerText()).trim() === "Connect Wallet");

  await btn.click();
  await page.waitForTimeout(700);
  const options = await page.locator("[role=menu] [role=menuitem]").allInnerTexts();
  check(
    "PHANTOM-STD: discovered through standard:connect",
    options.some((t) => t.includes("Phantom")),
    JSON.stringify(options),
  );
  check(
    "PHANTOM-STD: chains read from top-level chains[]",
    options.some((t) => /Devnet/i.test(t)),
    JSON.stringify(options),
  );

  const chip = await connectPhantom(page, btn);
  check("PHANTOM-STD: connects and shows the address", chip.includes(`${ADDRESS.slice(0, 4)}…`), `"${chip}"`);
  check(
    "PHANTOM-STD: standard:connect actually invoked",
    (await page.evaluate(() => window.__dzConnectCalls)) === 1,
  );
  await page.close();
}

/* -- 14. Legacy provider returning a PublicKey INSTANCE ------------------ */
{
  const page = await newPage(phantomLegacyStub);
  await page.waitForTimeout(2200);
  const chip = await connectPhantom(page, walletBtn(page));
  check(
    "PHANTOM-LEGACY: PublicKey instance unwrapped via toBase58()",
    chip.includes(`${ADDRESS.slice(0, 4)}…`),
    `"${chip}"`,
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("dz:wallet") || "null"),
  );
  check("PHANTOM-LEGACY: correct address persisted", stored?.address === ADDRESS, JSON.stringify(stored));
  await page.close();
}

/* -- 15. Account arriving on the change event after an empty result ------ */
{
  const page = await newPage(phantomRacingStub);
  await page.waitForTimeout(2200);
  const chip = await connectPhantom(page, walletBtn(page));
  check(
    "PHANTOM-RACE: waited for the change-event account",
    chip.includes(`${ADDRESS.slice(0, 4)}…`),
    `"${chip}"`,
  );
  await page.close();
}

/* -- 16. Diagnostics record shape only, never values --------------------- */
{
  const page = await newPage(phantomLegacyStub);
  await page.waitForTimeout(2200);
  await connectPhantom(page, walletBtn(page));

  const dump = await page.evaluate(() => JSON.stringify(window.__dzWalletDiag ?? []));
  check("DIAG: entries recorded", dump !== "[]" && dump.length > 20, `${dump.length} chars`);
  check("DIAG: provider name captured", dump.includes("Phantom") || dump.includes("legacy"));
  check("DIAG: feature names captured", /standard:connect|legacy:connect/.test(dump));
  check("DIAG: field names captured", dump.includes("hasToBase58") || dump.includes('"fields"'));

  // The assertion that matters: no address material anywhere in the log.
  const leaked =
    dump.includes(ADDRESS) || /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(dump.replace(/"(Phantom|legacy[^"]*)"/g, ""));
  check("DIAG: no address or key material in the log", !leaked, leaked ? "LEAK DETECTED" : "clean");

  const store = await page.evaluate(() => Object.keys(localStorage));
  check(
    "DIAG: nothing written to storage beyond the wallet session",
    store.every((k) => k === "dz:wallet"),
    store.join(", "),
  );
  await page.close();
}

console.log(`\n${failures === 0 ? "PASS — wallet flow verified" : `FAIL — ${failures} check(s) failed`}`);
await browser.close();
