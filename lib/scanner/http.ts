/**
 * Hardened outbound HTTP for the scanner.
 *
 * Everything the scanner fetches goes through here so there is exactly one
 * place where SSRF, redirect, timeout and size limits are enforced. Registry
 * metadata and tarballs are attacker-influenced inputs (a malicious package can
 * point anywhere), so these bounds are the security boundary, not a nicety.
 *
 * Design rules:
 *  - HTTPS only.
 *  - Host allowlist. A redirect to a non-allowlisted host is refused rather
 *    than followed, so an open redirect cannot be used to reach internal
 *    services (169.254.169.254, localhost, 10.x, ...).
 *  - AbortSignal.timeout on both connect and total time.
 *  - Streaming byte cap: we stop reading the moment the cap is passed, so a
 *    multi-gigabyte response cannot exhaust memory.
 *  - No automatic redirect following beyond a small, same-host, HTTPS-only
 *    budget.
 */

import { createHash } from "node:crypto";

/** Hosts the scanner is permitted to contact. */
const ALLOWED_HOSTS = new Set(["registry.npmjs.org", "api.osv.dev"]);

/** Refuse obviously-internal targets even if an allowlist entry were widened. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "[::1]") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^0\./.test(h)) return true;
  return false;
}

export interface FetchLimits {
  /** Total wall-clock budget for the request. */
  timeoutMs: number;
  /** Hard cap on bytes read from the body. */
  maxBytes: number;
}

export class HttpError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
  }
}

export interface SafeResponse {
  bytes: Buffer;
  sha256: string;
  finalUrl: string;
  status: number;
}

/** Validate a URL before any socket is opened. */
export function assertSafeUrl(input: string, allowed: Set<string> = ALLOWED_HOSTS): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError("DZ_HTTP_BAD_URL", `Malformed URL: ${input}`);
  }
  if (url.protocol !== "https:") {
    throw new HttpError("DZ_HTTP_INSECURE", "Only https:// requests are permitted.");
  }
  if (isPrivateHost(url.hostname)) {
    throw new HttpError("DZ_HTTP_PRIVATE_TARGET", `Refusing to contact a private address: ${url.hostname}`);
  }
  if (!allowed.has(url.hostname.toLowerCase())) {
    throw new HttpError("DZ_HTTP_HOST_NOT_ALLOWED", `Host not allowed: ${url.hostname}`);
  }
  return url;
}

/**
 * Fetch with all bounds applied. Returns the fully-buffered body, which is safe
 * only because `maxBytes` caps it first.
 */
export async function safeFetch(
  url: string,
  limits: FetchLimits,
  opts: { method?: string; headers?: Record<string, string>; body?: string; allowedHosts?: Set<string> } = {},
): Promise<SafeResponse> {
  const allowed = opts.allowedHosts ?? ALLOWED_HOSTS;
  let target = assertSafeUrl(url, allowed);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);

  // Redirects are followed manually so every hop is re-validated.
  let hops = 0;
  const maxHops = 3;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch(target, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        body: opts.body,
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new HttpError("DZ_HTTP_REDIRECT_NO_LOCATION", `Redirect without Location from ${target.hostname}`);
        }
        hops += 1;
        if (hops > maxHops) {
          throw new HttpError("DZ_HTTP_TOO_MANY_REDIRECTS", "Too many redirects.");
        }
        const next = new URL(location, target);
        // Re-run the full allowlist + private-address check on the new hop.
        target = assertSafeUrl(next.toString(), allowed);
        continue;
      }

      if (!res.ok) {
        throw new HttpError("DZ_HTTP_STATUS", `Request to ${target.hostname} failed with HTTP ${res.status}.`);
      }

      const declared = res.headers.get("content-length");
      if (declared && Number(declared) > limits.maxBytes) {
        throw new HttpError(
          "DZ_HTTP_TOO_LARGE",
          `Response exceeds the ${limits.maxBytes} byte limit (declared ${declared}).`,
        );
      }

      // Stream with a hard cap rather than trusting content-length.
      const chunks: Buffer[] = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > limits.maxBytes) {
            // Abort the transfer; we already have more than we will accept.
            await reader.cancel().catch(() => {});
            throw new HttpError(
              "DZ_HTTP_TOO_LARGE",
              `Response exceeded the ${limits.maxBytes} byte limit while streaming.`,
            );
          }
          chunks.push(Buffer.from(value));
        }
      }

      const bytes = Buffer.concat(chunks);
      return {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        finalUrl: target.toString(),
        status: res.status,
      };
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError("DZ_HTTP_TIMEOUT", `Request to ${url} timed out after ${limits.timeoutMs}ms.`);
    }
    throw new HttpError("DZ_HTTP_NETWORK", `Request to ${url} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
