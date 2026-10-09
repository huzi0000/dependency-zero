# Dependency Zero — Landing Page

The official marketing site for **Dependency Zero**, a decentralized
dependency-security network for autonomous coding agents, built on Solana.

> **Core story:** an agent requests a dependency → Dependency Zero intercepts it
> before execution → independent scanner nodes analyse it → verdicts are
> attested on-chain → **ALLOW** or **BLOCK**.

This repository contains the landing page only. It is a static, prerendered
Next.js route.

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, static prerender) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (`@theme` tokens in `app/globals.css`) |
| Icons | `lucide-react` for UI glyphs; official brand SVGs for logos |
| Fonts | `next/font/google` — Instrument Sans, Instrument Serif, IBM Plex Mono |
| Animation | CSS keyframes only (no animation library) |
| Runtime deps | `next`, `react`, `react-dom`, `lucide-react` — nothing else |

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
```

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run start      # serve the build
npm run typecheck  # type check only

# visual + behavioural QA (requires the production server on :3000)
node qa/shot.mjs 1440 1000 out.png     # full-page capture + overflow report
node qa/el.mjs 1440 "<selector>" o.png # element capture
node qa/behaviour.mjs                  # a11y / keyboard / reduced-motion suite
```

---

## Design system

Light theme only — no dark mode, no theme toggle, no `prefers-color-scheme`
behaviour. The black **Global Security Network** section is an intentionally
dark *content* section, not a theme.

| Token | Value | Use |
| --- | --- | --- |
| `--color-bone` | `#F1EFE8` | page background |
| `--color-surface` | `#FAF9F5` | cards, plates |
| `--color-ink` | `#171816` | primary ink |
| `--color-ink-soft` | `#3A3B37` | body copy |
| `--color-muted` | `#74766F` | secondary copy |
| `--color-label` | `#62645D` | 10–12px mono labels (AA contrast) |
| `--color-line` / `--color-line-soft` | `#D8D5CC` / `#E6E3DA` | 1px borders |
| `--color-lime` | `#D7FF3F` | signal — used sparingly |
| `--color-lime-ink` | `#556B0A` | lime *text* on light surfaces |
| `--color-void` | `#121212` | dark content section |
| `--color-safe` / `--color-warn` / `--color-blocked` | `#21875A` / `#B87918` / `#D94A3D` | status only |

Rules held throughout: no gradients, no glassmorphism, no decorative glow, no
purple, 1px borders, 6–10px radii, flat surfaces, generous whitespace.

### Type

* **Instrument Sans** — navigation, UI, headings, buttons, body.
* **IBM Plex Mono** — technical labels, metrics, package/system information.
* **Instrument Serif Italic** — selective editorial emphasis only
  (*Before Execution.*, section headlines, the final CTA).

### Layout

`--container-page: 1360px` shell with a 40px gutter yields a **1280px content
column** at a 1440px viewport — the reference composition.

Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Verified with no
horizontal overflow at 1440, 834, 390 and 360px.

---

## Components

```
components/
  Navbar.tsx              sticky nav, mobile sheet (Escape to close, scroll lock)
  Hero.tsx                eyebrow, ZERO TRUST. / Before Execution., video, metrics
  EcosystemMarquee.tsx    rule + label, seamless brand ticker
  ProblemSection.tsx      four threat cards (Lucide icons)
  GlobalNetwork.tsx       dark section, globe PNG, stats
  HowItWorks.tsx          01 SCAN / 02 VERIFY / 03 PROTECT
  FinalCTA.tsx            final headline, platform PNG, CTAs
  Footer.tsx              compact single row: logo · links · socials · copyright
  brand/
    EcosystemLogos.tsx    brand data + optically normalised <BrandMark>
    SocialIcons.tsx       official GitHub / Discord / Telegram glyphs
  icons/
    StepDiagrams.tsx      hand-built SVG isometric diagrams (SCAN / VERIFY / PROTECT)
  ui/
    Button.tsx            ActionLink / ActionButton variants
    Callout.tsx           TagCallout (hero) + TickCallout (globe / platform)
    Reveal.tsx            IntersectionObserver fade-up, CSS transition
  app/                    console (dashboard / scan / network), route group only
    AppShell.tsx          sidebar + topbar shell, off-canvas drawer below lg
    Sidebar.tsx           three real routes, live Devnet status
    Topbar.tsx            search (Ctrl/Cmd+K), wallet chip, alerts
    DashboardView.tsx     metric cards, activity chart, recent scans, network
    ThreatActivityChart.tsx   stacked SVG chart, no charting dependency
    MetricCard.tsx        metric + sparkline, honest deltas only
    RecentScans.tsx       latest scans -> /scan/[id]
    NetworkOverview.tsx   supplied dotted world map, illustrative label
    Attestations.tsx      network stats + attestation table
    ScanConsole.tsx       scan request form + history
    WalletChip.tsx       connect / connected control (never disabled)
    WalletRequirement.tsx  shared wallet state + mandatory-wallet gate
    RangeControl.tsx      24H / 7D / 30D / ALL
    TimeAgo.tsx           hydration-safe relative timestamps
    useWallet.ts          discovery, connect, verify, disconnect (no dependency)
    verdict.tsx           status chips + presentation map
    CopySignatureButton.tsx
    EmptyState.tsx        empty / not-enough-data states
```

### Motion hierarchy

1. **Hero video** — the supplied `hero-visuals.mp4` (strongest motion).
2. **Ecosystem marquee** — 52s linear loop, pauses on hover/focus.
3. **Very subtle** — 5px globe/platform float, per-step micro-animation, reveal.

Everything collapses to a static end state under
`prefers-reduced-motion: reduce`; the marquee becomes horizontally scrollable
so no brand is unreachable.

### Seamless marquee

The track renders the brand list twice and translates by exactly `-50%`, with
`gap-80px` and `px-40px` (half the gap) so the visual period divides the track
width in half:

```
W = 40 + 2n·168 + (2n−1)·80 + 40 = 496n   →   W/2 = 248n = n · (168 + 80)
```

---

## Assets

All artwork ships locally under `public/`. Nothing is fetched at runtime.

| File | Role | Notes |
| --- | --- | --- |
| `public/hero-visuals.mp4` | hero visual | 1920×1080, 8s, autoplay/muted/loop/playsInline, no native controls, `poster="hero-poster.jpg"` |
| `public/global-network-globe.png` | dark section globe | 1536×1024, real alpha |
| `public/isometric-network-platform.png` | final CTA | 1536×1024, real alpha |
| `public/brand/logo-trimmed.png` | navbar + footer + console sidebar logo | trimmed from the supplied logo |
| `public/brand/dependency-zero-logo.png` | original, untouched | |
| `public/Dotted World Map with Green Data Points.png` | console Network Overview | supplied asset, used as a decorative backdrop |
| `app/icon.png` | favicon | mark cropped from the logo |

The console map's green dots are **part of the artwork**, not scanner
locations. The panel is labelled illustrative and only draws real markers when
a registered node carries verified geo metadata.

The hero video ships on a flat neutral-grey field. `.flat-art` lifts that field
to white with a levels filter and multiplies it onto the bone page, so no
rectangular plate is visible. The globe and platform PNGs already carry real
alpha and are rendered untouched.

### Brand marks (`public/brands/`)

Authentic marks taken from each project's **own repository**, then flattened to
a single ink colour so the ticker reads as a restrained monochrome strip. No
mark was drawn, traced or approximated by hand.

| Brand | Source |
| --- | --- |
| Solana | `coral-xyz/backpack` → `web/public/brands/solana.svg` |
| Phantom | `helius-labs/frontend-boilerplate` → `public/phantom.svg` |
| Backpack | `coral-xyz/backpack` → `web/public/backpack.svg` |
| Helius | `helius-labs/frontend-boilerplate` → `public/helius-logo.svg` |
| Raydium | `raydium-io/raydium-ui` → `src/assets/icons/logo-text.svg` |
| Jito | `jito-foundation/ncn-portal` → `public/icons/jito_logo_white.webp` (recoloured to ink) |
| GitHub / Discord / Telegram / X | Simple Icons paths, inlined in `components/brand/SocialIcons.tsx` |

All marks remain the property of their respective owners and are used here
solely to indicate ecosystem compatibility. **No endorsement, partnership or
"trusted by" claim is made** — the strip is labelled *Built for the Solana
ecosystem*.

---

## Accessibility

* Semantic `header` / `nav` / `main` / `section` / `footer`; one `h1`, no
  heading-level skips.
* Mobile menu: `aria-expanded`, `aria-controls`, Escape to close, body scroll
  lock, focus-visible rings throughout.
* Decorative artwork is `aria-hidden`; meaningful imagery has descriptive alt
  text; the hero video is `tabIndex={-1}`.
* Lighthouse: **Accessibility 100 · Best Practices 100 · SEO 100**.
* Small uppercase mono labels use `--color-label` rather than `--color-muted` so
  10–12px technical text clears WCAG AA on the bone surface.

### Console contrast note

The locked `--color-muted` (#74766F) only reaches **4.0:1** on white and
`--color-faint` (#A3A49C) **2.2:1**, so neither is used for console body text.
Console surfaces use `--color-label` (#62645D, 5.2–6.0:1) throughout. The
semantic safe / warn / blocked tokens are likewise a step short for small text
(4.5 / 3.6 / 4.2:1), so chips, icons, deltas and alert copy use darkened steps
of the same hues — `#155534`, `#6B440B`, `#8A2C23` — all ≥ 6.4:1. The hues are
unchanged; only their lightness is.

`qa/a11y.mjs` re-checks all of this (contrast, accessible names, form labels,
heading order, landmarks, image alt, table semantics, duplicate ids) on every
console route at 1440px and 390px.

## Performance

* Static prerender, no client data fetching, no animation library.
* Video `preload="metadata"` with a poster; below-fold images lazy-load through
  `next/image` (AVIF/WebP, explicit intrinsic sizes to avoid CLS).
* Fonts self-hosted and preloaded by `next/font` with `display: swap`.
* Marquee and floats are compositor-only (`transform` / `opacity`).

---

## Console (`/app`, `/scan`, `/network`)

The console is a separate route group, `app/(console)/`, so the landing page
keeps its own layout untouched. Nothing under `components/app/` or `lib/` is
imported by the landing page.

### Data layer

`lib/store.ts` is a file-backed repository behind a small interface, so a real
database can be swapped in without touching any UI. **It starts empty and never
seeds fabricated records.** Writes go to the OS application-data directory
(`%LOCALAPPDATA%\dependency-zero\data`, `~/Library/Application Support/…`,
`$XDG_DATA_HOME/…`), deliberately **outside the project tree** — a store inside
it makes Next's watcher recompile on every write. Override with `DZ_DATA_DIR`.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `SOLANA_RPC_URL` | no | Devnet RPC. Defaults to the public `api.devnet.solana.com`. Point at Helius (free tier) only if rate limits bite. |
| `DZ_DATA_DIR` | no | Where the file store writes. Defaults to the OS app-data directory. |

No key material, seed phrase or private key is used or accepted anywhere.

### API

| Route | Method | Returns |
| --- | --- | --- |
| `/api/scans` | GET / POST | list or search scans; create a scan request (validated npm name + version) |
| `/api/scans/[id]` | GET | one scan record |
| `/api/metrics?range=` | GET | range-filtered metrics, bucketed series and axis labels |
| `/api/attestations` | GET | resolved scans that carry a **real** on-chain signature |
| `/api/nodes` | GET | registered scanner nodes + live RPC status |
| `/api/rpc-status` | GET | Devnet health, core version, latency |
| `/api/wallet/verify` | GET | confirms a connected address exists on chain (`getBalance`) |

### What is real vs. pending

Implemented and verified against live systems:

* scan request → validation → persistence → dashboard metrics → report page
* time-range filtering (state, URL and fetched data all agree; deep-linkable)
* Ctrl/Cmd+K search across package, scan id and signature
* Solana Devnet connectivity (real `getHealth` + `getVersion` round trip)
* wallet connect/discover/disconnect with **both** the Wallet Standard API and
  the legacy injected providers (`window.phantom.solana`, `window.solana`,
  `window.backpack`, `window.keplr`, `window.xverse`), address verified on
  Devnet. No wallet-adapter dependency is used.

### Wallet

Phantom's actual API shape was read out of the installed extension
(v26.32.0) and is recorded in `lib/wallet-phantom.ts`. Two facts broke the
connect flow:

* **Phantom names its Wallet Standard features `standard:connect`,
  `standard:disconnect` and `standard:events`.** The string
  `connect:disconnect` does not appear anywhere in the extension, so code that
  only looks for `connect` / `connect:disconnect` rejects Phantom's Wallet
  Standard wallet and silently falls back to the legacy shim. All three naming
  conventions are now supported.
* **`publicKey` is a class instance, not a string.** The legacy provider
  resolves `connect()` with `{ publicKey: <PublicKey> }`, where `PublicKey`
  exposes `toBase58()` / `toBytes()`. Code assuming a base58 string receives
  `null` and reports *"Wallet returned no account."* — the exact error reported
  against the real extension.

Connect therefore cascades through every source a wallet might use — the
`connect()` result, the feature's accounts, the wallet's accounts, and the
provider's `publicKey` — unwrapping `PublicKey` instances at each step. If the
result is still empty, it waits up to 8s for a `change` event, because Phantom
resolves `standard:connect` with an empty account list when its key is not yet
populated and fills it in moments later.

Discovery normalises every provider into one shape, so Phantom, Backpack,
Xverse and Keplr appear in the same list and a wallet exposing *both* APIs
appears exactly once. `WalletChip` reads a single shared `useWallet()` instance
from `WalletRequirementProvider` — two instances meant two discovery loops, and
because React runs child effects first, the second `navigator.wallets.register()`
call overwrote the first, so late-registering wallets stayed invisible.

Discovery keeps re-scanning for 6s (400ms poll, plus `register()`, `pageshow`
and `focus`) because extensions can register well after first paint. The
control is **never disabled**: with no provider it still opens and explains how
to install, and offers "Re-check for wallets".

Errors are classified rather than dumped — rejection (`4001`), locked wallet,
not-yet-authorised, unsupported chain, and no-provider each get their own
message, and no raw error code reaches the UI. A failed attempt persists
nothing.

`WalletRequirementProvider` is the mandatory-wallet gate: `requireWallet(action)`
runs `action` only when a verified wallet is connected. It is an explicit opt-in
rather than a global guard so **autonomous background scanner operations are
never blocked** — scanners authenticate with their own registered node identity
(`ScannerNode.identity`), not a browser session. Browsing the Dashboard remains
available while disconnected.

**No private key or seed phrase is ever requested, read, stored or sent.** The
extension signs internally; the app only reads back a public address.
`qa/wallet.mjs` asserts no key-like data reaches any API or `localStorage`.

#### Diagnostics

`lib/wallet-diagnostics.ts` records provider *shape* only — provider name,
feature key names, counts, and field/method names — so provider-specific
failures can be diagnosed without touching anything sensitive. There is no code
path that can serialise a value; `safeShape()` reads `typeof`, key names and
method names, and reports only `hasToBase58` / `hasToBytes` / `hasPublicKey` /
`hasAddress` booleans.

Load `http://localhost:3000/app?dzdiag=1` to log to the console, or read
`window.__dzWalletDiag` in DevTools at any time. `qa/wallet.mjs` asserts the log
contains no address material.

Awaiting infrastructure, shown as honest empty states rather than faked:

* **Scanner nodes.** No node has registered, so a submitted scan stays
  `PENDING`. No scanner engine exists to resolve a verdict, so
  `resolveScan()` in `lib/store.ts` is the integration boundary and is not
  called by any route.
* **Attestations.** Requires a resolved scan with a real transaction
  signature. `attestationSignature` is only ever set from a real transaction;
  no signature is ever generated, so the table is legitimately empty.
* **Network accuracy / consensus rate.** Both need resolved scans (30 for
  accuracy) and, for consensus, a configured quorum. Shown as `—` with an
  explanation rather than estimated.
* **Map markers.** Nodes carry optional geo fields; real markers render only
  when that metadata is verified.

### QA

Run with the production server (`npm run build && npm run start`) — the dev
server's watcher makes timings unreliable on a synced folder.

| Script | Covers |
| --- | --- |
| `qa/e2e.mjs` | API contract: validation, creation, search, metrics, 404s, RPC |
| `qa/interactions.mjs` | 38 assertions on every control: ranges, search, nav, scan form, focus, mobile drawer |
| `qa/console-check.mjs` | HTTP status, console/page errors, overflow on 3 routes × 6 breakpoints + landing |
| `qa/wallet.mjs` | 52 assertions: discovery (standard / legacy / late / none), connect, Devnet verification, address display, disconnect, rejection, locked, invalid address, re-check, no key material, **Phantom `standard:connect` feature names**, **PublicKey instance unwrapping**, **change-event account race**, **diagnostics leak check** |
| `qa/a11y.mjs` | contrast, accessible names, labels, headings, landmarks, alt, table semantics |
| `qa/axis.mjs` | chart x-axis labels never overlap or clip, 4 ranges × 6 breakpoints |
| `qa/shots.mjs` | full-page screenshots at every breakpoint |
| `qa/behaviour.mjs` | landing-page regression guard (20 assertions) |
