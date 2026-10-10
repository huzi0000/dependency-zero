import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  XCircle,
} from "lucide-react";

import type { ScanFinding } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Key threats                                                                 */
/* -------------------------------------------------------------------------- */

const SEVERITY_CHIP: Record<ScanFinding["severity"], string> = {
  critical: "bg-[#FBE9E6] text-[#8A2C23]",
  high: "bg-[#FBE9E6] text-[#8A2C23]",
  medium: "bg-[#FBF0DC] text-[#6B440B]",
  low: "bg-[#FBF0DC] text-[#6B440B]",
  info: "bg-[#EFEDE4] text-[#62645D]",
};

export function KeyThreats({ findings }: { findings: ScanFinding[] }) {
  return (
    <section className="dz-card flex flex-col" aria-labelledby="key-threats">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <AlertTriangle aria-hidden="true" strokeWidth={1.8} className="size-[17px] text-ink" />
        <h2 id="key-threats" className="text-[15px] font-bold text-ink">
          Key Threats
        </h2>
      </div>

      {findings.length === 0 ? (
        <p className="mono-body px-4 py-6 text-center text-[12px] leading-[1.6] text-label">
          No findings have been reported. A scanner node records threats here once it
          evaluates this package.
        </p>
      ) : (
        <ul>
          {findings.map((f, i) => (
            <li key={`${f.rule}-${i}`} className="dz-row">
              <div className="flex items-center gap-3 px-4 py-2.5">
                {f.severity === "critical" || f.severity === "high" ? (
                  <XCircle
                    aria-hidden="true"
                    strokeWidth={2}
                    className="size-[17px] shrink-0 text-[#D94A3D]"
                  />
                ) : f.severity === "info" ? (
                  <CheckCircle2
                    aria-hidden="true"
                    strokeWidth={2}
                    className="size-[17px] shrink-0 text-[#21875A]"
                  />
                ) : (
                  <AlertTriangle
                    aria-hidden="true"
                    strokeWidth={2}
                    className="size-[17px] shrink-0 text-[#B87918]"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{f.rule}</span>
                  <span className="mono-body mt-0.5 block text-[11.5px] leading-[1.5] text-label">
                    {f.detail}
                  </span>
                </span>
                <span
                  className={`mono-label shrink-0 rounded px-2 py-[3px] text-[9.5px] ${SEVERITY_CHIP[f.severity]}`}
                >
                  {f.severity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Code evidence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * File / line / snippet evidence.
 *
 * Real evidence arrives with the scanner result once the engine exists. Until
 * then this renders an informative empty state — it never displays fabricated
 * source code.
 */
export function CodeEvidence({
  evidence,
}: {
  evidence?: { file: string; lines: string[] };
}) {
  if (!evidence) {
    return (
      <section className="dz-card flex flex-col" aria-labelledby="code-evidence">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
          <FileCode2 aria-hidden="true" strokeWidth={1.8} className="size-[17px] text-ink" />
          <h2 id="code-evidence" className="text-[15px] font-bold text-ink">
            Code Evidence
          </h2>
        </div>
        <p className="mono-body px-4 pb-5 text-[12px] leading-[1.6] text-label">
          No suspicious code has been flagged. Source excerpts appear here with file
          paths and line numbers once a scanner reports a finding.
        </p>
      </section>
    );
  }

  return (
    <section className="dz-card flex flex-col" aria-labelledby="code-evidence">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
        <FileCode2 aria-hidden="true" strokeWidth={1.8} className="size-[17px] text-ink" />
        <h2 id="code-evidence" className="text-[15px] font-bold text-ink">
          Code Evidence
        </h2>
      </div>
      <div className="mono-body px-4 text-[11.5px] text-label">{evidence.file}</div>
      <pre className="dz-scroll mx-4 mb-4 mt-2 max-h-[220px] overflow-auto rounded-[6px] bg-[#171816] p-3 text-[11.5px] leading-[1.6] text-[#E8E6DE]">
        <code>
          {evidence.lines.map((line, i) => (
            <span key={i} className="block">
              <span className="mr-3 inline-block w-4 select-none text-right text-[#6C6E66]">
                {i + 1}
              </span>
              {line}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
