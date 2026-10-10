import type { ScanResolution } from "../scanner/types.ts";

/**
 * Enforcement policy: the firewall's mandatory behaviour.
 *
 *   ALLOW  -> installation may proceed
 *   REVIEW -> HELD. No automatic installation. A human decision is required.
 *   BLOCK  -> installation prevented before npm starts
 *   ERROR / timeout / unknown -> installation prevented (fail-closed)
 *
 * There is deliberately no `--force` or `--no-guard` escape hatch. A bypass
 * flag would make the whole product decorative: an agent that wants to install
 * a malicious package would simply pass the flag. REVIEW therefore stays held,
 * and the documented way out is a human running the command directly after
 * reviewing the Threat Report.
 */

export type EnforcementAction =
  | "ALLOWED_INSTALL"
  | "BLOCKED_BEFORE_EXECUTION"
  | "REVIEW_HELD";

export interface EnforcementDecision {
  action: EnforcementAction;
  /** Whether npm may be spawned at all. */
  permit: boolean;
  exitCode: number;
  reason: string;
}

/** Exit codes are distinct so an agent can branch on them. */
export const EXIT_ALLOWED = 0;
export const EXIT_BLOCKED = 2;
export const EXIT_REVIEW_HELD = 3;
export const EXIT_SCANNER_UNAVAILABLE = 4;
export const EXIT_COMMAND_REJECTED = 5;

export interface EnforceInput {
  /** Resolution per coordinate. `null` means the scan did not complete. */
  results: Map<string, ScanResolution | null>;
  coordinates: string[];
}

export function decide(results: EnforceInput["results"], coordinates: string[]): EnforcementDecision {
  const blocked: string[] = [];
  const review: string[] = [];
  const failed: string[] = [];
  const allowed: string[] = [];

  for (const c of coordinates) {
    const r = results.get(c);
    if (!r) {
      failed.push(c);
      continue;
    }
    if (r.verdict === "block") blocked.push(c);
    else if (r.verdict === "review") review.push(c);
    else if (r.verdict === "allow") allowed.push(c);
    else failed.push(c);
  }

  // BLOCK wins over everything.
  if (blocked.length > 0) {
    return {
      action: "BLOCKED_BEFORE_EXECUTION",
      permit: false,
      exitCode: EXIT_BLOCKED,
      reason: `Blocked by security verdict: ${blocked.join(", ")}. npm was not started.`,
    };
  }

  // Fail-closed: a scan that did not complete is never treated as permission.
  if (failed.length > 0) {
    return {
      action: "BLOCKED_BEFORE_EXECUTION",
      permit: false,
      exitCode: EXIT_SCANNER_UNAVAILABLE,
      reason:
        `Scanner did not produce an authoritative verdict for: ${failed.join(", ")}. ` +
        `Failing closed; npm was not started.`,
    };
  }

  if (review.length > 0) {
    return {
      action: "REVIEW_HELD",
      permit: false,
      exitCode: EXIT_REVIEW_HELD,
      reason:
        `Held for human review: ${review.join(", ")}. ` +
        `This tool does not auto-install REVIEW verdicts. Review the Threat Report, ` +
        `then install manually if acceptable.`,
    };
  }

  return {
    action: "ALLOWED_INSTALL",
    permit: true,
    exitCode: EXIT_ALLOWED,
    reason: `Security verdict ALLOW for: ${allowed.join(", ")}.`,
  };
}
