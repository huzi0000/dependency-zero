/**
 * In-process rate limiting.
 *
 * No `server-only` guard: this module holds no secrets and touches no store, so
 * the test suite can import it directly. Keeping it importable is the point —
 * the limiter is the control that stops the expensive routes being amplified,
 * and it should be testable without standing up a server.
 *
 *
 * WHAT THIS IS
 *
 * A demo-level brake on the two genuinely expensive routes: scan submission,
 * which causes outbound requests to the npm registry and OSV and then unpacks a
 * tarball, and attestation verification, which makes an RPC call per request.
 *
 * WHAT THIS IS NOT
 *
 * It is not a distributed rate limiter. State lives in this process's memory, so
 * a multi-instance or serverless deployment resets it on every cold start and
 * does not share counts between instances. A client can also trivially get a new
 * budget by changing the address used to derive its key. It exists to stop
 * casual abuse of a demo instance, and `docs/DEPLOYMENT.md` says so.
 *
 * Client identity is derived from the first value in a small allowlist of
 * forwarding headers, falling back to a single shared bucket. Trusting an
 * arbitrary `X-Forwarded-For` wholesale would let a caller mint unlimited
 * identities by rotating the header, which would be worse than no limiting.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Housekeeping so the map cannot grow without bound on a long-running server. */
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Namespace, so two routes with the same limit do not share a counter. */
  scope: string;
}

/**
 * Check a request against the limiter.
 *
 * Returns allowed=false plus a retry-after value rather than throwing, so the
 * caller can answer 429 with the same headers on every route.
 */
export function checkRateLimit(
  request: Request,
  opts: RateLimitOptions,
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);

  const key = `${opts.scope}:${clientKey(request)}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, opts.limit - 1),
      retryAfterSeconds: Math.ceil(opts.windowMs / 1000),
    };
  }

  existing.count += 1;

  if (existing.count > opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, opts.limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/**
 * Derive a stable client key.
 *
 * Only headers a known proxy sets are read, and only the first value of each is
 * used. An unset header yields a shared bucket, which is the conservative
 * outcome: it limits everyone together rather than trusting a self-reported
 * address.
 */
function clientKey(request: Request): string {
  const trusted = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"];
  for (const header of trusted) {
    const raw = request.headers.get(header);
    if (!raw) continue;
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return "shared";
}

/** Standard rate-limit response headers. */
export function rateLimitHeaders(info: {
  limit?: number;
  remaining: number;
  retryAfterSeconds: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(info.remaining),
    "Retry-After": String(info.retryAfterSeconds),
  };
}

/** Test-only: forget all counters. Never called from a request path. */
export function __resetRateLimits(): void {
  buckets.clear();
  lastSweep = Date.now();
}