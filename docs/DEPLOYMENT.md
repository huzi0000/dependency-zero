# Deployment

Dependency Zero is suitable for a **controlled public hackathon demo** on a
single long-lived Node host with persistent storage.

It is **not production-hardened.** This document says exactly what that means.

---

## 1. Requirements

- Node 20 or newer
- A writable, **persistent** directory
- Optional: a Solana Devnet RPC provider

No database, no build-time secrets, no external services.

## 2. Build and run

```sh
npm ci
npm run build
npm start            # binds 0.0.0.0:3000 by default
```

`npm run build` must complete before `npm start`. Do not build while a server is
running against the same directory.

## 3. Persistent storage — REQUIRED

Everything lives under one directory:

```
<DATA_DIR>/dependency-zero.json          scans, firewall events, attestations
<DATA_DIR>/keys/scanner-identities.json  Ed25519 signing keys
```

Set `DZ_DATA_DIR` to a **mounted persistent volume**:

```sh
DZ_DATA_DIR=/var/lib/dependency-zero
```

> **Do not deploy to ephemeral serverless hosting.** On a cold start the store
> and the signing keys would both be lost. Regenerated keys cannot verify
> evidence signed by the previous ones, so previously exported proofs would stop
> verifying against the rebuilt registry.

The default location is the OS application-data directory. On a Linux container
this resolves inside the container filesystem, which is usually ephemeral.

### Verifying persistence survived

1. Run a scan.
2. Note the scan id.
3. Restart the process.
4. Confirm the scan is still listed and that `keys/scanner-identities.json` has
   the same modification time.

A loud warning is logged when signing keys are regenerated over a key directory
that already existed.

## 4. One store per process

Writes are serialised **within a single Node process only**. Two processes
writing the same file can interleave read-modify-write cycles and lose a record.

This matters here because the OpenCode npm guard runs in a separate process and
writes the same store. Give each its own directory:

```sh
# the web server
DZ_DATA_DIR=/var/lib/dependency-zero

# the OpenCode guard, in its own environment
DZ_DATA_DIR=/var/lib/dependency-zero-agent
```

Set `DZ_STORE_ISOLATED=1` once you have done this, to silence the startup
warning.

A real fix needs file locking or a database. Neither is in scope for V1.

## 5. Environment variables

All optional. See `.env.example`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DZ_DATA_DIR` | **In production** | Must be a persistent volume. |
| `DZ_STORE_ISOLATED` | No | Set `1` only after separating stores per process. |
| `SOLANA_RPC_URL` | Recommended | The public Devnet endpoint is rate limited. |
| `DZ_SOLANA_KEYPAIR_BASE58` | No | Enables automated anchoring. Without it, anchoring is skipped and reported honestly. |
| `DZ_SOLANA_KEYPAIR_FILE` | No | As above. |

`SOLANA_RPC_URL` changes **where** requests are sent, never **which** network is
used. The product is Devnet-only by design and accepts no network parameter.

Never commit a filled-in `.env`.

## 6. Security posture

Implemented:

- Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` (`next.config.ts`)
- In-process rate limiting on scan creation, attestation recording and attestation
  verification (`lib/rate-limit.ts`)
- Attestation recording requires a cryptographically valid transaction carrying
  the correct commitment and scan id — possessing a scan id is not authorisation
- The attestation record is only marked confirmed after an independent on-chain
  check; a signature string alone never confirms
- Conflicting re-anchoring is refused with HTTP 409
- Scanner private keys are `server-only` and never reach a client bundle
- Bundle export refuses to emit anything matching a key-material pattern
- Outbound HTTP is HTTPS-only, host-allowlisted, and blocks private and cloud
  metadata addresses

Not implemented — treat as open for a real deployment:

- **No authentication or authorisation** on any route. Anyone can read scans and
  enumerate ids.
- **Rate limiting is in-process.** It resets on restart and does not coordinate
  across instances. A distributed deployment needs shared state.
- **No structured logging or request correlation.**
- **No HSTS.** Add it at the reverse proxy once TLS is terminated.

## 7. Reverse proxy

Terminate TLS at a proxy and forward to the Node process. Add HSTS there. Wallet
connections require a secure context, so a plain-HTTP IP address will not work
for the wallet flow.

## 8. Checklist

- [ ] `npm ci && npm run build` completes with exit 0
- [ ] `DZ_DATA_DIR` points at a persistent, backed-up volume
- [ ] Scan, restart, confirm the scan and the key file survived
- [ ] Each Dependency Zero process has its own `DZ_DATA_DIR`
- [ ] `SOLANA_RPC_URL` set to a provider, not the public endpoint, if the demo is
      busy
- [ ] TLS terminated at the proxy; HSTS added there
- [ ] Rate limits reviewed against expected demo traffic
- [ ] `.env` is not committed; no `.env` values appear in logs
- [ ] `npm test` passes
- [ ] `npm run d0-verify` against an exported bundle returns VERIFIED
- [ ] The store file is backed up if the demo must survive host loss

## 9. Capacity

The store is a single JSON document re-serialised on every write, so cost grows
with the number of records. A demo deployment with thousands of scans will see
increasing latency. `db.firewall` is capped at 500 events; `db.scans` and
`db.attestations` are not capped, and are never truncated automatically.

## 10. What is genuinely solid

Not everything here is prototype-grade. These are real:

- Outbound HTTP / SSRF defence (`lib/scanner/http.ts`)
- Memo-program constant-drift defence: writes and verifications validate against
  separately pinned constants
- Independent on-chain verification that recomputes the commitment locally
- Deterministic consensus with a clamp that can never be more permissive than the
  security verdict
- No signature fabrication anywhere in the pipeline