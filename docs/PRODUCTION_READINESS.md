# Production Deployment Readiness

Scope note: this phase introduced **no** persistence redesign and **no**
infrastructure changes beyond adding `@solana/web3.js`. This document records
what must happen before running this outside a development machine. Nothing here
is implemented.

## Blockers — must be resolved before production

### 1. Storage is a single local JSON file, and it is not concurrency-safe

`lib/store-core.ts` writes one JSON document via a temp file plus rename. That is
adequate for a single-machine prototype and **not** adequate for production:

- No file locking. Two server processes or overlapping requests can interleave
  read-modify-write cycles and lose a scan record.
- No transactional guarantee across process boundaries.
- Unbounded growth. The file now holds every scan, every attestation and every
  proof bundle; bundles are ~6.7 KB each and grow linearly.
- No backup, rotation or integrity mechanism.

Required: move to a transactional store (Postgres or equivalent), add a real
migration path, and make the existing 139 records an import rather than an
in-place upgrade.

### 2. Automatic anchoring has no durable retry

The attestation lifecycle (`not_started → signing → ready_to_submit →
submitted → confirmed → failed`) and the idempotency key are implemented, but
retry is currently **operator-triggered only**. There is no background worker.

Required: a durable queue with bounded exponential backoff, and a distinction
that already exists in code but is not yet exercised by a scheduler — a
transaction whose outcome is *unknown* must be retried, while one that
*definitely failed on chain* must not be.

### 3. The attester key needs a real provisioning path

Today the key comes from `DZ_SOLANA_KEYPAIR_BASE58` or
`DZ_SOLANA_KEYPAIR_FILE`. Production needs a secrets manager or HSM-backed
signer, key rotation, and an operational runbook for a leaked attester key.
Note that a leaked attester key allows forging *anchors*, not scanner verdicts —
the two key classes are deliberately separate.

### 4. Devnet is not a production cluster

Devnet has no availability guarantee and its faucet is frequently rate-limited
(observed repeatedly during this phase). Anchoring to mainnet would require
real funds and a real budget for fees, which is a product decision, not a code
change. Do not silently switch clusters.

## Should be done

- **Rate limiting** on `/api/scans`, `/api/attestations/[id]` and the bundle
  export. The verification endpoint makes an outbound RPC call per request and is
  currently unauthenticated and unmetered.
- **AuthN/AuthZ.** There is none. Any client can enumerate scan IDs and export
  proof bundles.
- **Structured logging with correlation IDs.** Attestation failures currently
  surface only through stored record fields.
- **Alerting** for the real failure modes: attestation stuck unconfirmed,
  registry hash drift, signature verification failure rate above zero.
- **Bundle size limits** on export, and a retention policy for stored bundles.
- **Supply-chain pinning** for the new `@solana/web3.js` dependency tree. It
  brings transitive packages that should be reviewed and pinned before shipping.

## Explicitly out of scope for this phase

- Deploying an on-chain registry or attestation program. This requires a Rust
  toolchain that this environment does not have. See `docs/TRUST_MODEL.md` §2.
- Multi-operator key distribution. The protocol supports it; no independent
  operator has been onboarded.
- Replacing the Memo mechanism. Memo is correct for tamper-evident
  timestamping and is labelled accurately everywhere it appears.
- Behavioural or sandbox analysis. Scanner C is integrity analysis, not a
  sandbox, and is never described as one.

## Verified in this phase

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | exit 0 |
| `npm test` | 131/131 |
| Secret audit (repo) | no key material |
| Key store location | outside repository |
| Legacy scan records | 78 preserved, unmodified |
| Firewall audit events | 8 preserved |
| Client bundle isolation | verified by build; `server-only` boundary held |

## Not verified in this phase

- **A genuine confirmed Devnet transaction.** The attester keypair is
  provisioned but has a zero balance; the public faucet returned
  *"You've either reached your airdrop limit today or the airdrop faucet has run
  dry."* Every anchoring attempt failed at
  `Attempt to debit an account but found no record of a prior credit`. The
  transaction-building, signing and chain-verification code paths are complete
  and exercised, but the on-chain confirmation path has not completed a real
  transaction. Funding the attester address is the single missing step.
- **Real Phantom approval.** All wallet checks use stubs; the browser harness
  loads no extensions. Manual verification in a real Chrome is required.