# Dependency Zero

An npm dependency security firewall for AI-assisted development. It inspects a
package before it installs, signs the findings with Ed25519, returns a
deterministic **ALLOW / REVIEW / BLOCK** verdict, and can optionally anchor a
commitment hash to **Solana Devnet**.

Anyone can verify a scan afterwards with a standalone CLI that needs no access to
this application.

---

## What D0 does

| Capability | Status |
| --- | --- |
| npm registry metadata resolution | Real |
| Published tarball integrity check (`dist.integrity`) | Real |
| Real archive inspection (paths, symlinks, traversal) | Real |
| OSV vulnerability advisory lookup | Real |
| Static suspicious-pattern detection | Real |
| Deterministic ALLOW / REVIEW / BLOCK policy | Real |
| Three Ed25519 signed scanner roles | Real, **local, one operator** |
| CLI guard that blocks unsafe installs before npm runs | Real |
| OpenCode pre-execution interception | Real, **scoped** |
| Exportable signed proof bundles | Real |
| Independent verification of a bundle | Real |
| Solana Devnet SPL Memo anchoring | Real, **optional** |

## What D0 does **not** do

Stated plainly, because the difference matters:

- **No decentralised scanner network.** Three scanner roles run as analytical
  modules on one machine under one operator. **Zero** independently operated
  nodes exist. Their signatures prove internal consistency and tamper-evidence —
  not third-party verification.
- **No on-chain scanner registry.** No Solana program is deployed. The registry
  is a local, off-chain list.
- **No runtime sandbox.** Package code is **never executed**. Findings are read
  out of the archive.
- **No AI-powered malware detection.** There is no model in the pipeline.
- **No complete transitive analysis.** Transitive resolution is not implemented.
- **No guarantee of detection.** A clean verdict is not proof of safety.
- **No universal agent interception.** The OpenCode plugin covers supported npm
  commands in one shell tool. See "Agent interception" below.

Solana stores a **cryptographic commitment**, not the scan report, and not a
malware verdict. Anchoring is always optional — enforcement never depends on it.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Marketing site |
| `/app` | Dashboard |
| `/scan` | Submit and run a scan |
| `/scan/[id]` | Threat report and proof export |
| `/network` | Scanner registry, consensus, attestations |

## Setup

```sh
npm install
npm run build
npm start          # http://localhost:3000
```

Development: `npm run dev`.

Requires Node 20+. No database, no external services.

### Environment

All variables are optional; the app boots with none of them and degrades to
honest "not connected" states. Copy `.env.example` to `.env`.

| Variable | Purpose |
| --- | --- |
| `DZ_DATA_DIR` | Where scans, firewall events, attestations and signing keys live. **Set this to a persistent volume in production** — see below. |
| `DZ_STORE_ISOLATED` | Set `1` only after giving each process its own `DZ_DATA_DIR`. |
| `SOLANA_RPC_URL` | Devnet RPC endpoint. Default is the public rate-limited endpoint. |
| `DZ_SOLANA_KEYPAIR_BASE58` | Devnet attester key, for automated anchoring. |
| `DZ_SOLANA_KEYPAIR_FILE` | Path to a Devnet attester keyfile. |

Never commit a filled-in `.env`. No seed phrase is ever requested, read or stored.

## CLI

```sh
npm run d0 -- guard -- npm install <package>
```

Blocks unsafe installs **before** npm runs. Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | ALLOWED — npm ran |
| `2` | BLOCKED by security verdict |
| `3` | REVIEW held — a human must decide |
| `4` | Scanner unavailable (fail-closed) |
| `5` | Command rejected as unsafe |

There is deliberately **no override flag**. A bypass would make the product
decorative.

## Independent proof verification

Export a proof bundle from a scan report, then verify it with no trust in this
application:

```sh
npm run d0-verify -- path/to/d0-proof-<id>.json
```

The verifier imports no store and no `@solana/web3.js`, holds no credentials,
and re-derives everything it can: each Ed25519 signature, the scanner consensus
from the signed payloads, the canonical commitment, and — when online — that the
transaction exists on Devnet, used the SPL Memo program, and carries the same
commitment.

| Code | Meaning |
| --- | --- |
| `0` | VERIFIED |
| `1` | Failed (tampered or inconsistent) |
| `2` | Bundle unreadable |
| `3` | Chain check unavailable — **not a pass** |
| `6` | NOT_ATTESTED — no transaction reference at all |

## Agent interception (OpenCode plugin)

`.opencode/plugins/d0-npm-guard.ts` is discovered automatically. It vets supported
npm install commands before the shell runs them, using the same scanner, policy
and audit trail as the CLI.

Enforced: `npm install`, `npm i`, `npm add`, explicit `@version` coordinates,
pathed npm binaries, and installs behind shell separators. Anything with shell
metacharacters is refused rather than interpreted.

Held with an explanation, because they install code D0 cannot enumerate first:
`npm ci`, `npm update`, `npm upgrade`.

**Known bypasses:** shell aliases, wrapper commands (`bash -c`, `xargs`),
other package managers, and a renamed shell tool. This is bash-tool interception,
not universal agent security. Full scope and limitations:
[`docs/OPENCODE_PLUGIN.md`](docs/OPENCODE_PLUGIN.md).

## Tests

```sh
npm test
```

Offline and deterministic. The suite injects the registry, the advisory API and
the audit sink, so it never writes to the real store.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full checklist.

Suitable for a **controlled public demo** on a single long-lived Node host with
a persistent volume. **Not production-hardened**: file-backed single-writer
storage, local key custody, a public rate-limited Devnet endpoint, and
in-process rate limiting.

Do **not** deploy to ephemeral serverless hosting: scans, firewall events,
attestations and the signing keys would all be lost on every cold start.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md) | What the signatures and the anchor do and do not prove |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deployment, persistence, configuration, checklist |
| [`docs/OPENCODE_PLUGIN.md`](docs/OPENCODE_PLUGIN.md) | Agent interception scope and limitations |
| [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) | Outstanding hardening work |

## Known limitations

- Cross-process writes to one `DATA_DIR` can lose records; the store serialises
  writes within a single process only.
- Rate limiting is in-process and resets on restart.
- Scanner signing keys are local. Losing them makes previously signed evidence
  unverifiable against a rebuilt registry.
- Solana Devnet is a test cluster with no availability guarantee.