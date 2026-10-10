/**
 * Rule catalogue.
 *
 * Every rule has a stable, documented id. Ids are part of the public contract:
 * they appear in scan records and Threat Reports, so they must never be
 * renumbered or reused for different behaviour.
 *
 * Severity here is the *rule's* severity. The final verdict is produced by the
 * policy engine, which considers severity together with confidence, corroboration
 * and incomplete checks.
 */

import type { Severity } from "./types";

export type DetectorId = "lifecycle" | "source" | "metadata";

export interface RuleDef {
  id: string;
  detector: DetectorId;
  severity: Severity;
  title: string;
  description: string;
  /**
   * Whether a hit on its own is enough to BLOCK. Most rules are not: a lone
   * pattern match is evidence, not proof, and treating it as proof is how
   * scanners cry wolf.
   */
  blockingAlone: boolean;
}

export const RULES: RuleDef[] = [
  /* ---- Detector A: lifecycle scripts ---------------------------------- */
  {
    id: "D0-LC-001",
    detector: "lifecycle",
    severity: "critical",
    title: "Install script pipes a remote script into a shell",
    description:
      "A lifecycle script downloads remote content and pipes it straight to sh/bash. This executes code the package author controls at install time, bypassing review of what actually runs.",
    blockingAlone: true,
  },
  {
    id: "D0-LC-002",
    detector: "lifecycle",
    severity: "high",
    title: "Install script executes a downloaded file",
    description:
      "A lifecycle script downloads a file then executes it, a common dropper pattern.",
    blockingAlone: false,
  },
  {
    id: "D0-LC-003",
    detector: "lifecycle",
    severity: "medium",
    title: "Install script spawns a shell",
    description:
      "A lifecycle script invokes a shell interpreter or shell -c. Common in legitimate build tooling, so it is reported for review rather than treated as proof of malice.",
    blockingAlone: false,
  },
  {
    id: "D0-LC-004",
    detector: "lifecycle",
    severity: "high",
    title: "Install script reads credential material",
    description:
      "A lifecycle script references well-known credential paths such as ~/.aws/credentials, ~/.npmrc or ssh keys.",
    blockingAlone: false,
  },
  {
    id: "D0-LC-005",
    detector: "lifecycle",
    severity: "medium",
    title: "Install script transmits data to the network",
    description:
      "A lifecycle script combines a sensitive-file read with an outbound network call, which is the shape of exfiltration.",
    blockingAlone: false,
  },
  {
    id: "D0-LC-006",
    detector: "lifecycle",
    severity: "low",
    title: "Package defines install lifecycle scripts",
    description:
      "The package runs code during installation. This is normal and not itself suspicious; it is recorded so a reviewer can see that install-time code exists at all.",
    blockingAlone: false,
  },

  /* ---- Detector B: source patterns ------------------------------------ */
  {
    id: "D0-SRC-001",
    detector: "source",
    severity: "high",
    title: "Reads process environment variables",
    description:
      "Source enumerates process.env or an equivalent. This is ubiquitous in legitimate packages and only becomes meaningful when corroborated by obfuscation, dynamic execution or outbound exfiltration.",
    blockingAlone: false,
  },
  {
    id: "D0-SRC-002",
    detector: "source",
    severity: "high",
    title: "Reaches for credential files",
    description:
      "Source references credential storage paths such as ~/.aws, ~/.ssh, or browser secret stores.",
    blockingAlone: false,
  },
  {
    id: "D0-SRC-003",
    detector: "source",
    severity: "high",
    title: "Executes a string as code",
    description:
      "Source passes data to eval, new Function, or equivalent dynamic execution.",
    blockingAlone: false,
  },
  {
    id: "D0-SRC-004",
    detector: "source",
    severity: "medium",
    title: "Obfuscated execution chain",
    description:
      "Source reconstructs code at runtime from escaped or base64-decoded strings and then executes it.",
    blockingAlone: false,
  },
  {
    id: "D0-SRC-005",
    detector: "source",
    severity: "medium",
    title: "Spawns a child process",
    description:
      "Source spawns a shell or external command. Routine in build tooling, reported for review rather than assumed malicious.",
    blockingAlone: false,
  },
  {
    id: "D0-SRC-006",
    detector: "source",
    severity: "low",
    title: "Makes outbound network requests",
    description:
      "Source performs network I/O. Expected for most packages; recorded so exfiltration findings can be corroborated.",
    blockingAlone: false,
  },

  /* ---- Detector C: metadata & advisories ------------------------------ */
  {
    id: "D0-META-001",
    detector: "metadata",
    severity: "high",
    title: "Known vulnerable version",
    description:
      "The published advisory database lists a vulnerability affecting this exact package and version.",
    blockingAlone: false,
  },
  {
    id: "D0-META-002",
    detector: "metadata",
    severity: "medium",
    title: "Package is deprecated",
    description: "The registry marks this package or version as deprecated.",
    blockingAlone: false,
  },
  {
    id: "D0-META-003",
    detector: "metadata",
    severity: "info",
    title: "Advisory data unavailable",
    description:
      "The advisory service could not be reached, so vulnerability checking did not complete. An unavailable check is never treated as a clean result.",
    blockingAlone: false,
  },
  {
    id: "D0-META-004",
    detector: "metadata",
    severity: "info",
    title: "Archive contained unsafe entries",
    description:
      "The tarball contained entries with unsafe paths or types. They were refused and never inspected or written anywhere.",
    blockingAlone: false,
  },
];

export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function ruleTitle(id: string): string {
  return RULE_BY_ID.get(id)?.title ?? id;
}
