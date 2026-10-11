/**
 * Regression tests for the Phase 3 remediation.
 *
 * Each test here corresponds to a defect found in the Phase 3 audit and would
 * have failed before the fix. They are offline and deterministic: no network,
 * no store writes, no npm execution.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { truncateSignature } from "../lib/format.ts";
import { isTestGeneratedFirewallEvent, partitionFirewallEvents } from "../lib/firewall-events.ts";
import type { FirewallEvent } from "../lib/scanner/types.ts";

/* -------------------------------------------------------------------------- */
/* P0-1 — dashboard crash on a null transaction signature                      */
/* -------------------------------------------------------------------------- */

describe("P0-1 — an unanchored attestation has no signature, and says so", () => {
  it("does not throw on null", () => {
    // This is the exact crash: `sig.length` on null threw a TypeError and
    // blanked the whole dashboard.
    assert.doesNotThrow(() => truncateSignature(null));
  });

  it("does not throw on undefined or an empty string", () => {
    assert.doesNotThrow(() => truncateSignature(undefined));
    assert.doesNotThrow(() => truncateSignature(""));
  });

  it("states the absence rather than rendering an empty cell", () => {
    assert.equal(truncateSignature(null), "Not anchored");
    assert.equal(truncateSignature(undefined), "Not anchored");
  });

  it("still truncates a real signature", () => {
    const sig = "3doeWTCPSiiqjzU6AexCXpBvNgFt1tXDdpxcdiZNqtWjTR93MJjiS2twHnYL6ZDFwdXUANxT4qMRsHZbMfcvSmKf";
    const out = truncateSignature(sig);
    assert.equal(out, "3doe…SmKf");
    assert.ok(!out.includes("null"));
  });

  it("leaves a short signature intact", () => {
    assert.equal(truncateSignature("abc"), "abc");
  });
});

/* -------------------------------------------------------------------------- */
/* P1-10 — separating test-generated firewall events from real ones            */
/* -------------------------------------------------------------------------- */

function event(overrides: Partial<FirewallEvent>): FirewallEvent {
  return {
    id: overrides.id ?? "e",
    timestamp: "2026-01-01T00:00:00.000Z",
    command: ["npm", "install", "left-pad"],
    coordinates: [],
    scanIds: [],
    verdicts: ["allow"],
    action: "ALLOWED_INSTALL",
    reason: "",
    npmExecuted: false,
    exitCode: 0,
    ...overrides,
  };
}

describe("P1-10 — test contamination is filterable but never hidden", () => {
  it("recognises the known test fixtures", () => {
    for (const coord of [
      "d0-safe-fixture@1.0.0",
      "d0-vuln-fixture@1.0.0",
      "d0-review-fixture@1.0.0",
      "d0-outage-fixture@1.0.0",
      "left-pad",
      "x@1.0.0",
    ]) {
      assert.equal(
        isTestGeneratedFirewallEvent({ coordinates: [coord] }),
        true,
        coord,
      );
    }
  });

  it("does not classify real package coordinates as tests", () => {
    for (const coord of ["axios@1.7.2", "express@4.18.2", "lodash@4.17.15", "is-number@7.0.0"]) {
      assert.equal(isTestGeneratedFirewallEvent({ coordinates: [coord] }), false, coord);
    }
  });

  it("does not guess when an event carries no coordinates", () => {
    // A rejected command has none. Claiming to know its origin would be a
    // fabricated classification, so it stays in the operational set.
    assert.equal(isTestGeneratedFirewallEvent({ coordinates: [] }), false);
    assert.equal(isTestGeneratedFirewallEvent({}), false);
  });

  it("splits a mixed trail and preserves the raw total", () => {
    const events: FirewallEvent[] = [
      event({ id: "1", coordinates: ["axios@1.7.2"], command: ["npm", "install", "axios@1.7.2"] }),
      event({ id: "2", coordinates: ["d0-safe-fixture@1.0.0"] }),
      event({ id: "3", coordinates: ["left-pad"] }),
      event({ id: "4", coordinates: ["is-number@7.0.0"] }),
    ];

    const split = partitionFirewallEvents(events);

    assert.equal(split.rawTotal, 4, "the raw count must always be available");
    assert.equal(split.operational.length, 2);
    assert.equal(split.testGenerated.length, 2);
    assert.equal(split.operational.length + split.testGenerated.length, split.rawTotal);
  });

  it("never mutates the events it partitions", () => {
    const events = [event({ id: "1", coordinates: ["axios@1.7.2"] })];
    const before = JSON.stringify(events);
    partitionFirewallEvents(events);
    assert.equal(JSON.stringify(events), before);
  });
});

/* -------------------------------------------------------------------------- */
/* P1-14 — RPC configuration is honoured by the attestation path               */
/* -------------------------------------------------------------------------- */

describe("P1-14 — one configured Devnet endpoint", () => {
  it("resolves SOLANA_RPC_URL when set", async () => {
    const { rpcEndpoint, SOLANA_CLUSTER } = await import("../lib/config.ts");
    const previous = process.env.SOLANA_RPC_URL;
    process.env.SOLANA_RPC_URL = "https://example.invalid/rpc";
    try {
      assert.equal(rpcEndpoint(), "https://example.invalid/rpc");
      // The cluster is still Devnet regardless of the endpoint. An endpoint
      // setting changes WHERE requests go, never WHICH network is used.
      assert.equal(SOLANA_CLUSTER, "devnet");
    } finally {
      if (previous === undefined) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = previous;
    }
  });

  it("falls back to the public Devnet endpoint when unset", async () => {
    const { rpcEndpoint } = await import("../lib/config.ts");
    const previous = process.env.SOLANA_RPC_URL;
    delete process.env.SOLANA_RPC_URL;
    try {
      assert.equal(rpcEndpoint(), "https://api.devnet.solana.com");
    } finally {
      if (previous !== undefined) process.env.SOLANA_RPC_URL = previous;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* P1-15 — rate limiting                                                       */
/* -------------------------------------------------------------------------- */

describe("P1-15 — expensive routes are rate limited", () => {
  it("allows up to the limit and then refuses, per scope", async () => {
    const { checkRateLimit, __resetRateLimits } = await import("../lib/rate-limit.ts");
    __resetRateLimits();

    const req = () => new Request("http://localhost/api/scans", { headers: { "x-real-ip": "10.0.0.1" } });
    const opts = { scope: "test-limiter", limit: 3, windowMs: 60_000 };

    assert.equal(checkRateLimit(req(), opts).allowed, true);
    assert.equal(checkRateLimit(req(), opts).allowed, true);
    assert.equal(checkRateLimit(req(), opts).allowed, true);

    const blocked = checkRateLimit(req(), opts);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSeconds > 0);

    __resetRateLimits();
  });

  it("separates scopes so two routes do not share a budget", async () => {
    const { checkRateLimit, __resetRateLimits } = await import("../lib/rate-limit.ts");
    __resetRateLimits();

    const req = () => new Request("http://localhost/api/x", { headers: { "x-real-ip": "10.0.0.2" } });
    for (let i = 0; i < 5; i++) checkRateLimit(req(), { scope: "a", limit: 1, windowMs: 60_000 });

    assert.equal(checkRateLimit(req(), { scope: "a", limit: 1, windowMs: 60_000 }).allowed, false);
    assert.equal(checkRateLimit(req(), { scope: "b", limit: 1, windowMs: 60_000 }).allowed, true);

    __resetRateLimits();
  });

  it("uses a shared bucket when no trusted forwarding header is present", async () => {
    const { checkRateLimit, __resetRateLimits } = await import("../lib/rate-limit.ts");
    __resetRateLimits();

    // Trusting an arbitrary self-reported address would let a caller mint new
    // identities by rotating the header, which is worse than no limit at all.
    const spoof = () => new Request("http://localhost/api/x", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const opts = { scope: "shared-test", limit: 1, windowMs: 60_000 };

    checkRateLimit(spoof(), opts);
    assert.equal(checkRateLimit(spoof(), opts).allowed, false, "rotating an untrusted header must not reset the bucket");

    __resetRateLimits();
  });
});