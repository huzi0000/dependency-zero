/**
 * The three scanner roles.
 *
 * IMPORTANT DISCLOSURE: these are three distinct ANALYTICAL MODULES running in
 * one process on one machine, operated by one party. They are not three
 * independent third-party operators and provide no decentralisation. What they
 * do provide is separable evidence: each role reaches its own conclusion from the
 * same downloaded artifact, each is signed separately, and a disagreement
 * between them is surfaced rather than averaged away.
 *
 * All three consume the SAME already-resolved, already-inspected artifact. The
 * package is downloaded exactly once per scan and shared.
 */

import type { Finding, ScanResolution } from "@/lib/scanner/types.ts";
import type { TarballContents } from "@/lib/scanner/tarball.ts";
import { RULE_BY_ID } from "@/lib/scanner/rules.ts";
import { evaluatePolicy } from "@/lib/scanner/policy.ts";
import type { ScannerRole } from "./canonical.ts";

export const SCANNER_VERSION = "d0-scanner/2.0.0";

export interface ScannerInput {
  scanId: string;
  resolvedName: string;
  resolvedVersion: string;
  artifactSha256: string;
  /** Findings already produced by the shared detection pass (Phase 1). */
  findings: Finding[];
  advisories: ScanResolution["advisories"];
  dependencies: ScanResolution["dependencies"];
  contents: TarballContents;
  registry: string;
  /** Integrity verification result from the Phase 1 pipeline. */
  integrityVerified: boolean;
  integrityNote: string | null;
  incompleteChecks: string[];
  timestamp: number;
}

export interface ScannerAssessment {
  role: ScannerRole;
  scanId: string;
  resolvedName: string;
  resolvedVersion: string;
  artifactSha256: string;
  scannerVersion: string;
  policyVersion: string;
  /** Only this role's findings. */
  findings: Finding[];
  riskScore: number;
  proposedVerdict: "allow" | "review" | "block";
  rationale: string;
  completionStatus: "completed" | "failed";
  timestamp: number;
}

/** Rules owned by each role. Drives the partition below. */
const ROLE_RULES: Record<ScannerRole, string[]> = {
  static_lifecycle: ["D0-LC-001", "D0-LC-002", "D0-LC-003", "D0-LC-004", "D0-LC-005", "D0-LC-006", "D0-SRC-001", "D0-SRC-002", "D0-SRC-003", "D0-SRC-004", "D0-SRC-005", "D0-SRC-006"],
  dependency_advisory: ["D0-META-001", "D0-META-002", "D0-META-003"],
  artifact_integrity: ["D0-META-004"],
};

function findingsForRole(all: readonly Finding[], role: ScannerRole): Finding[] {
  const owned = new Set(ROLE_RULES[role]);
  return all.filter((f) => owned.has(f.ruleId));
}

/** Shared per-role policy evaluation so all three score identically. */
function assess(input: ScannerInput, role: ScannerRole): ScannerAssessment {
  const findings = findingsForRole(input.findings, role);
  const incompleteChecks = [...input.incompleteChecks];
  let rationaleExtra = "";

  // Artifact & Integrity owns the structural safety facts about the container.
  if (role === "artifact_integrity") {
    if (!input.integrityVerified) {
      incompleteChecks.push("Published artifact integrity could not be verified.");
    }
    if (input.contents.truncated) {
      incompleteChecks.push("Archive inspection was truncated by a safety limit.");
    }
    rationaleExtra =
      `Archive contained ${input.contents.fileCount} inspected entries, ` +
      `${input.contents.rejected.length} refused as unsafe, ` +
      `${input.integrityVerified ? "integrity verified against the registry" : "integrity NOT verified"}.`;
  }

  // Dependency & Advisory owns the advisory availability question.
  if (role === "dependency_advisory") {
    rationaleExtra =
      input.advisories.state === "checked"
        ? `${input.advisories.vulnerabilities.length} published advisory record(s) matched this exact version; ${input.dependencies.direct.length} direct dependencies declared.`
        : "Advisory data was unavailable, so vulnerability checking did not complete.";
  }

  if (role === "static_lifecycle") {
    const evidenceFiles = new Set(findings.flatMap((f) => f.evidence.map((e) => e.file)));
    rationaleExtra =
      `Static and lifecycle review examined ${input.contents.fileCount} archive entries; ` +
      `${findings.length} finding(s) across ${evidenceFiles.size} distinct location(s).`;
  }

  const decision = evaluatePolicy({ findings, incompleteChecks });

  return {
    role,
    scanId: input.scanId,
    resolvedName: input.resolvedName,
    resolvedVersion: input.resolvedVersion,
    artifactSha256: input.artifactSha256,
    scannerVersion: SCANNER_VERSION,
    policyVersion: decision.policyVersion,
    findings,
    riskScore: decision.riskScore,
    proposedVerdict: decision.verdict,
    rationale: `${decision.rationale} ${rationaleExtra}`.trim(),
    completionStatus: "completed",
    timestamp: input.timestamp,
  };
}

/** Scanner A — source, lifecycle scripts and execution patterns. */
export function scannerStaticLifecycle(input: ScannerInput): ScannerAssessment {
  return assess(input, "static_lifecycle");
}

/** Scanner B — dependencies, OSV advisories and vulnerability policy. */
export function scannerDependencyAdvisory(input: ScannerInput): ScannerAssessment {
  return assess(input, "dependency_advisory");
}

/**
 * Scanner C — artifact identity and integrity.
 *
 * This is NOT a behavioural sandbox. It never executes package code, and its
 * findings are about the container and its provenance, not runtime behaviour.
 */
export function scannerArtifactIntegrity(input: ScannerInput): ScannerAssessment {
  return assess(input, "artifact_integrity");
}

/** Run all three roles over the shared artifact. */
export function runAllScanners(input: ScannerInput): ScannerAssessment[] {
  return [scannerStaticLifecycle(input), scannerDependencyAdvisory(input), scannerArtifactIntegrity(input)];
}

/** Human label for a role, used in the UI and proof bundles. */
export const ROLE_LABEL: Record<ScannerRole, string> = {
  static_lifecycle: "Static & Lifecycle Analysis",
  dependency_advisory: "Dependency & Advisory Analysis",
  artifact_integrity: "Artifact & Integrity Analysis",
};

export { RULE_BY_ID };
