# Dependency Zero

**An npm install firewall for AI-assisted development — it signs what it finds, blocks before npm runs, and lets you verify the evidence independently.**

Dependency Zero inspects a package before it is installed: it resolves the real npm
coordinate, verifies the published tarball against its integrity hash, reads the actual
archive, queries OSV advisories, and applies a deterministic policy that returns
**ALLOW**, **REVIEW**, or **BLOCK**. Findings are signed with Ed25519 and can optionally
be anchored to Solana Devnet as a tamper-evident commitment.

Every exported proof bundle can be re-verified by a standalone CLI that shares no code,
no credentials, and no trust with the web application.

---

## Table of contents

- [Why](#why)
- [How it works](#how-it-works)
- [Verdicts](#verdicts)
- [Trust model](#trust-model)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [CLI guard](#cli-guard)
- [Proof verification](#proof-verification)
- [OpenCode plugin](#opencode-plugin)
- [Routes](#routes)
- [Development](#development)
- [Security model](#security-model)
- [Known limitations](#known-limitations)
- [Project status](#project-status)

---

## Why

An AI coding agent runs `npm install` without reading the source of what it is
pulling in. Install scripts execute arbitrary code, dependencies nest transitively, and
the manifest rarely matches the artifact.

Dependency Zero moves the decision in front of the install. It vets the coordinate
against the real registry and the real published bytes, then permits, holds, or refuses.
The package code is never executed during analysis.

## How it works

```
  npm install <pkg>
        │
        ▼
  ┌───────────────────┐
  │  Coordinate parse │  strict: rejects URLs, git, file:, workspace:, aliases
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │ Registry resolve  │  dist-tags, version, dist.integrity
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │ Integrity verify  │  sha512 of downloaded bytes vs dist.integrity
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │  Archive inspect  │  entry paths, symlinks, traversal, per-file static patterns
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │ OSV advisory join │  vulnerabilities affecting this exact name@version
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │ Policy evaluation │  weighted findings → ALLOW / REVIEW / BLOCK
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │  Ed25519 signing  │  three scanner roles sign their own findings
  └───────────────────┘
        │
        ▼
  ┌───────────────────┐
  │ Consensus + anchor│  quorum over signed votes → optional SPL Memo commitment
  └───────────────────┘
        │
        ▼
   npm runs, or it does not
```

### Scanner roles

Three analytical modules produce independent, separately signed findings:

| Role | Scope |
| --- | --- |
| `static_lifecycle` | Install hooks (`D0-LC-*`), source patterns (`D0-SRC-*`) |
| `dependency_advisory` | OSV advisories and registry metadata (`D0-META-001..003`) |
| `artifact_integrity` | Tarball integrity and archive safety (`D0-META-004`) |

All three run on **one machine under one operator identity**. See
[Trust model](#trust-model).

## Verdicts

| Verdict | Risk score | Behaviour |
| --- | --- | --- |
| **ALLOW** | `< 25` | Installation proceeds |
| **REVIEW** | `>= 25` | **Held.** No automatic install; a human must decide |
| **BLOCK** | `>= 60` | Installation refused before npm starts |

Additional failure modes never degrade to ALLOW:

| Condition | Result |
| --- | --- |
| Registry unreachable | ERROR — fail-closed |
| Tarball unreadable or integrity mismatch | ERROR — fail-closed |
| Any mandatory check incomplete | ERROR — fail-closed |

Thresholds are defined in `lib/scanner/policy.ts` and versioned as
`d0-policy/1.0.0`.

## Trust model

This is the part worth reading carefully.

**What the signatures prove.** Each of the three scanner roles signs its own findings
with Ed25519 over a canonical serialisation. The consensus is recomputed from those
signed payloads. A tampered finding, a changed verdict, or a swapped artifact hash
invalidates the bundle. This gives **internal consistency and tamper-evidence**.

**What the signatures do not prove.** The three roles are analytical modules on a single
host under a single operator. **Zero independently operated nodes exist.** There is no
decentralised scanner network, and no on-chain registry program is deployed. Three
signatures from one machine prove the evidence was not altered after signing — they do
**not** constitute third-party verification, and they do not establish that a different
party agreed with the verdict.

**What Solana anchoring proves.** Anchoring writes a single hash to Solana Devnet inside
an SPL Memo transaction. The hash commits to the artifact, the three signed results, and
the consensus. It proves **the evidence has not changed** since it was written. It is:

- **not** a statement that the package is safe,
- **not** a malware verdict,
- **not** a copy of the report on-chain,
- **not** required — every scan completes and exports a bundle with anchoring disabled.

A clean verdict is not proof of safety, and a high risk score is not proof of malice.

Full detail: [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md).

## Requirements

| Requirement | Version |
| --- | --- |
| Node.js | **>= 22.6.0** |
| npm | >= 10 |
| Disk | A writable directory for the scan store |

Node 22.6 is the floor because `d0`, `d0-verify` and the test runner all use
`node --experimental-strip-types`.

No database, no Docker, no external services. Solana Devnet is optional.

## Quick start

```sh
git clone https://github.com/huzi0000/dependency-zero.git
cd dependency-zero

npm install
npm run build
npm start
```

Open <http://localhost:3000>.

For development with hot reload:

```sh
npm run dev
```

## Configuration

Every variable is optional. With none set, the application boots and degrades to honest
"not connected" states. Copy `.env.example` to `.env` to override.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DZ_DATA_DIR` | **In production** | Location of the scan store and signing keys. Must be a persistent volume. |
| `DZ_STORE_ISOLATED` | No | Set to `1` only after giving each process its own `DZ_DATA_DIR`. |
| `SOLANA_RPC_URL` | No | Devnet RPC endpoint. Defaults to the public, rate-limited endpoint. |
| `DZ_SOLANA_KEYPAIR_BASE58` | No | Devnet attester key for automated anchoring. |
| `DZ_SOLANA_KEYPAIR_FILE` | No | Path to a Devnet attester keyfile. |

The cluster is always **Devnet**. `SOLANA_RPC_URL` changes *where* requests are sent, not
*which* network is used.

Dependency Zero never requests, reads, or stores a seed phrase. A filled-in `.env` is
already covered by `.gitignore`.

## CLI guard

Block an unsafe install before npm executes:

```sh
npm run d0 -- guard -- npm install <package>[@version] ...
```

Examples:

```sh
# Blocked: known-vulnerable version
npm run d0 -- guard -- npm install lodash@4.17.15

# Multiple coordinates; one BLOCK refuses the whole batch
npm run d0 -- guard -- npm install is-number@7.0.0 tar@6.1.11

# Allowed
npm run d0 -- guard -- npm install is-number@7.0.0
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | ALLOWED — npm ran |
| `2` | BLOCKED by security verdict |
| `3` | REVIEW held — a human must decide |
| `4` | Scanner unavailable (fail-closed) |
| `5` | Command rejected as unsafe |

There is deliberately **no override flag**. A bypass would make the product decorative.
The documented way past a REVIEW verdict is a human reading the Threat Report and then
running the install directly.

Only `npm install` is guarded. Everything else returns exit code `5`.

## Proof verification

Export a bundle from a scan report at `/scan/[id]` → *Export proof bundle*, then verify it
with no trust in the application:

```sh
npm run d0-verify -- path/to/d0-proof-<scan-id>.json
```

Useful flags:

```sh
npm run d0-verify -- bundle.json --offline          # no network calls
npm run d0-verify -- bundle.json --rpc <url>        # custom Devnet endpoint
```

The verifier imports no store, holds no keys, does not read the application's own
status field, and does not import `@solana/web3.js`. It independently recomputes every
commitment, verifies every signature against the public keys carried inside the bundle,
recomputes consensus from the signed payloads, and — when online — confirms the
transaction exists on Devnet, used the SPL Memo program, and carries the same commitment.

| Code | Meaning |
| --- | --- |
| `0` | VERIFIED |
| `1` | Failed — tampered or internally inconsistent |
| `2` | Bundle unreadable |
| `3` | Chain check unavailable — **not a pass** |
| `6` | NOT_ATTESTED — no transaction reference present |

Code `6` is deliberately distinct from `0`, so an unanchored bundle can never be mistaken
for a confirmed one.

## OpenCode plugin

`.opencode/plugins/d0-npm-guard.ts` is discovered automatically and vets supported npm
install commands before the shell runs them, through the same scanner, policy and audit
trail as the CLI.

**Enforced:** `npm install`, `npm i`, `npm add`, explicit `@version` coordinates, pathed
npm binaries, and installs behind shell separators.

**Held with an explanation:** `npm ci`, `npm update`, `npm upgrade` — these install code
D0 cannot fully enumerate first.

**Known bypasses:** shell aliases, wrapper commands (`bash -c`, `xargs`), other package
managers, and a renamed shell tool. This is bash-tool interception, not universal agent
security. See [`docs/OPENCODE_PLUGIN.md`](docs/OPENCODE_PLUGIN.md).

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Project landing page |
| `/app` | Dashboard |
| `/scan` | Submit a scan |
| `/scan/[id]` | Threat report and proof export |
| `/network` | Scanner registry, consensus activity, attestations |

## Development

```sh
npm run dev         # dev server on http://localhost:3000
npm run typecheck   # tsc --noEmit
npm test            # 230 tests, 33 suites, fully offline
npm run build       # production build
npm start           # serve the production build
```

The test suite is deterministic and offline: the registry, the OSV advisory API and the
audit sink are all injected, so it never writes to the real store and never depends on
npm being reachable.

Scan data, signing keys and attestations live **outside** the repository by default, in
the OS application-data directory. Override with `DZ_DATA_DIR`.

### Layout

```
app/                 Next.js App Router pages and API routes
components/          React components (app/ for console UI)
lib/
  scanner/           registry, tarball, detectors, policy
  attest/            Ed25519 signing, consensus, canonical encoding, Solana
  firewall/          command parsing, preflight, enforcement policy
  store-core.ts      file-backed persistence
cli/
  d0.ts              install firewall
  d0-verify.ts       standalone proof verifier
tests/               node:test suites
docs/                trust model, deployment, plugin scope, readiness
```

## Security model

- **Package code is never executed.** Analysis reads the archive as bytes and matches it
  with regular expressions.
- **Strict coordinate parsing.** Git URLs, `file:`, `workspace:`, `npm:` aliases,
  tarball URLs, encoded path separators and shell metacharacters are rejected, never
  interpreted.
- **SSRF-guarded egress.** Outbound requests are HTTPS-only and restricted to an
  allowlist of hosts, with private and loopback ranges refused.
- **Fail-closed.** An unreachable registry, an unreadable tarball, an integrity mismatch
  or an incomplete mandatory check all produce ERROR, never ALLOW.
- **Signed evidence.** Canonical serialisation is byte-stable and order-independent;
  changing any signed field invalidates the signature.
- **No bypass flag** anywhere in the enforcement path.
- Response headers include a strict Content Security Policy, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy` and `Permissions-Policy`. `'unsafe-eval'` is granted only
  in development builds.

## Known limitations

- **Transitive dependencies are not resolved.** Only the scanned package's own manifest is
  read.
- **The store is a single JSON file** serialised within one process. Two processes writing
  the same `DZ_DATA_DIR` can lose records; give each process its own directory, or run
  only one writer.
- **Rate limiting is in-process** and resets on restart.
- **Scanner signing keys are local.** Losing them makes previously signed evidence
  unverifiable against a rebuilt identity set.
- **Solana Devnet is a test cluster** with no availability guarantee.
- **No independent node operators exist**, so there is no third-party corroboration of a
  verdict.

## Project status

**V1.** The scanner, policy, signing, consensus, firewall, proof export and independent
verification are implemented and covered by the test suite. The web console is functional
and responsive.

Not yet done, and not claimed to be done:

- Public production deployment.
- A deployed on-chain scanner registry.
- Independent scanner operators.
- Transitive dependency resolution.
- Runtime or sandbox analysis.

Outstanding hardening work is tracked in
[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md). Deployment constraints —
persistent storage, single-writer requirement, TLS termination — are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## License

MIT — see [`LICENSE`](LICENSE).

Copyright (c) 2026 huzi0000.