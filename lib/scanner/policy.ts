/**
 * Deterministic policy engine.
 *
 * Turns findings into exactly one verdict: allow | review | block.
 *
 * Two properties are deliberate and testable:
 *
 *  1. DETERMINISM. The same findings and policy version always produce the same
 *     verdict and the same score. There is no randomness, no clock input, and no
 *     ordering dependence on network results.
 *  2. NO FAIL-OPEN. Anything the scanner could not complete is recorded in
 *     `incompleteChecks`, and any non-empty list forces at least REVIEW. An
 *     uncertain scan can never produce ALLOW.
 *
 * The score is a reporting aid, not proof. A high score on a heuristic pattern
 * is a reason for a human to look, not a statement that a package is malware.
 */

import { POLICY_VERSION } from "./types.ts";
import { RULE_BY_ID } from "./rules.ts";
import type { Finding, Severity } from "./types.ts";

export interface PolicyInput {
  findings: Finding[];
  incompleteChecks: string[];
}

export interface PolicyOutcome {
  verdict: "allow" | "review" | "block";
  riskScore: number;
  rationale: string;
  policyVersion: string;
}

/** Severity weights. Fixed, and versioned by POLICY_VERSION. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 40,
  high: 22,
  medium: 10,
  low: 4,
  info: 0,
};

/** Confidence multiplier. A low-confidence hit is worth much less. */
const CONFIDENCE_FACTOR = { high: 1, medium: 0.6, low: 0.25 } as const;

/** Score at or above which a corroborated pattern is treated as blocking. */
const REVIEW_THRESHOLD = 25;
const BLOCK_THRESHOLD = 60;

export function evaluatePolicy(input: PolicyInput): PolicyOutcome {
  const { findings, incompleteChecks } = input;

  const reasons: string[] = [];

  let raw = 0;
  for (const f of findings) {
    const base = SEVERITY_WEIGHT[f.severity] ?? 0;
    const factor = CONFIDENCE_FACTOR[f.confidence] ?? 0;
    raw += base * factor;
  }

  // Diminishing returns: ten low-severity hits should not outweigh one
  // critical, high-confidence finding by a wide margin.
  const riskScore = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 70)))));

  /* ---- BLOCK conditions ------------------------------------------------ */

  // A rule explicitly marked blocking, hit with high confidence, is sufficient.
  const decisive = findings.filter((f) => {
    const rule = RULE_BY_ID.get(f.ruleId);
    return rule?.blockingAlone === true && f.confidence === "high";
  });

  let verdict: PolicyOutcome["verdict"];

  if (decisive.length > 0) {
    verdict = "block";
    reasons.push(
      `${decisive.map((f) => `${f.ruleId} (${RULE_BY_ID.get(f.ruleId)?.title})`).join("; ")} matched with high confidence.`,
    );
  } else if (riskScore >= BLOCK_THRESHOLD) {
    // Name the dominant contributor so a BLOCK is never mistaken for a claim
    // that the package is malware. A package can reach BLOCK purely through
    // accumulated known vulnerabilities, which is a different fact.
    const advisoryCount = findings.filter((f) => f.kind === "advisory").length;
    const heuristicCount = findings.filter((f) => f.kind === "heuristic").length;
    const shape = [
      advisoryCount > 0 ? `${advisoryCount} published advisory/advisories` : null,
      heuristicCount > 0 ? `${heuristicCount} heuristic pattern match(es)` : null,
    ]
      .filter(Boolean)
      .join(" plus ");
    reasons.push(
      `Weighted finding score reached the blocking threshold (${riskScore} >= ${BLOCK_THRESHOLD})` +
        (shape ? `, driven by ${shape}` : "") +
        `. This means the install is refused. It is a risk decision about this ` +
        `version, not a claim that the package is malware; a high score alone is not proof of malice.`,
    );
    verdict = "block";
  } else if (incompleteChecks.length > 0) {
    verdict = "review";
    reasons.push(
      `Mandatory checks did not complete: ${incompleteChecks.join("; ")}. An incomplete scan cannot be allowed.`,
    );
  } else if (riskScore >= REVIEW_THRESHOLD) {
    verdict = "review";
    reasons.push(`Weighted finding score reached the review threshold (${riskScore} >= ${REVIEW_THRESHOLD}).`);
  } else if (
    findings.some(
      (f) =>
        (f.severity === "high" || f.severity === "critical") &&
        // Confidence gates the verdict. A LOW-confidence pattern match is an
        // observation, not a reason to hold an install: without this, any
        // package that merely reads process.env or imports child_process would
        // be held, which was verified against @babel/core on the real registry.
        f.confidence !== "low",
    )
  ) {
    verdict = "review";
    reasons.push("At least one high or critical finding was reported with credible confidence and requires human review.");
  } else {
    verdict = "allow";
    reasons.push("No blocking indicators were detected and every mandatory check completed.");
  }

  if (incompleteChecks.length > 0 && verdict === "block") {
    reasons.push("Some checks were also incomplete; the block rests on the findings listed above.");
  }

  if (findings.length > 0 && verdict !== "allow") {
    const counts = findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    reasons.push(
      `Finding counts: ${Object.entries(counts)
        .sort()
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")}.`,
    );
  }

  if (verdict === "allow" && findings.some((f) => f.severity === "low" || f.severity === "info")) {
    reasons.push("Only informational or low-severity observations were recorded.");
  }

  return {
    verdict,
    riskScore,
    rationale: reasons.join(" "),
    policyVersion: POLICY_VERSION,
  };
}
