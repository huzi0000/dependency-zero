import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  XCircle,
} from "lucide-react";

import type { ScanResolution, Severity } from "@/lib/scanner/types";
import type { ScanFinding } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Key threats                                                                 */
/* -------------------------------------------------------------------------- */

const SEVERITY_CHIP: Record<Severity, string> = {
  critical: "bg-[#FBE9E6] text-[#8A2C23]",
  high: "bg-[#FBE9E6] text-[#8A2C23]",
  medium: "bg-[#FBF0DC] text-[#6B440B]",
  low: "bg-[#FBF0DC] text-[#6B440B]",
  info: "bg-[#EFEDE4] text-[#62645D]",
};

function SeverityIcon({ severity }: { severity: Severity }) {
  const cls = "size-[17px] shrink-0";
  if (severity === "critical" || severity === "high") {
    return <XCircle aria-hidden="true" strokeWidth={2} className={`${cls} text-[#D94A3D]`} />;
  }
  if (severity === "info") {
    return <CheckCircle2 aria-hidden="true" strokeWidth={2} className={`${cls} text-[#21875A]`} />;
  }
  return <AlertTriangle aria-hidden="true" strokeWidth={2} className={`${cls} text-[#B87918]`} />;
}

/**
 * Security findings.
 *
 * When a real resolution exists the structured findings are rendered with their
 * documented rule id, severity, confidence and the exact evidence location that
 * came out of the tarball. Without a resolution the panel falls back to the flat
 * legacy finding list. Neither path ever invents a file, line or snippet.
 */
export function KeyThreats({
  findings,
  resolution,
}: {
  findings: ScanFinding[];
  resolution?: ScanResolution | null;
}) {
  const structured = resolution?.findings ?? [];
  const isLegacyOnly = structured.length === 0 && findings.length > 0;

  const total = structured.length || findings.length;

  return (
    <section className="dz-card flex flex-col" aria-labelledby="key-threats">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <AlertTriangle aria-hidden="true" strokeWidth={1.8} className="size-[17px] text-ink" />
        <h2 id="key-threats" className="text-[15px] font-bold text-ink">
          Key Threats
        </h2>
        {total > 0 ? (
          <span className="mono-body ml-auto text-[11px] text-label">{total}</span>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="mono-body px-4 py-6 text-center text-[12px] leading-[1.6] text-label">
          No findings were reported. Every mandatory check completed against the
          downloaded artifact without detecting a policy violation.
        </p>
      ) : structured.length > 0 ? (
        <ul>
          {structured.map((f, i) => (
            <li key={`${f.ruleId}-${i}`} className="dz-row">
              <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <SeverityIcon severity={f.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono-body text-[11px] text-label">{f.ruleId}</span>
                      <span className="text-[12.5px] font-semibold text-ink">{f.title}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-[1.5] text-ink-soft">{f.detail}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`mono-label shrink-0 rounded px-2 py-[3px] text-[9.5px] ${SEVERITY_CHIP[f.severity]}`}
                      >
                        {f.severity}
                      </span>
                      <span className="mono-label shrink-0 rounded bg-[#F0EEE6] px-2 py-[3px] text-[9.5px] text-label">
                        {f.confidence} confidence
                      </span>
                      <span className="mono-label shrink-0 rounded bg-[#F0EEE6] px-2 py-[3px] text-[9.5px] text-label">
                        {f.kind}
                      </span>
                    </div>

                    {f.evidence.length > 0 ? (
                      <ul className="mt-2.5 flex flex-col gap-1.5">
                        {f.evidence.map((e, j) => (
                          <li key={j}>
                            <p className="mono-body text-[10.5px] text-label">
                              {e.file}
                              {e.line ? `:${e.line}` : ""}
                            </p>
                            <pre className="dz-scroll mt-1 overflow-x-auto rounded-[5px] bg-[#F6F4ED] px-2.5 py-1.5 text-[11px] leading-[1.5] whitespace-pre-wrap text-ink">
                              <code>{e.snippet}</code>
                            </pre>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {f.source ? (
                      <p className="mono-body mt-2 text-[10.5px] text-label">
                        source: {f.source.name}
                        {f.source.id ? ` ${f.source.id}` : ""}
                        {f.source.url ? (
                          <>
                            {" · "}
                            <a
                              href={f.source.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="underline underline-offset-2 hover:text-ink"
                            >
                              advisory
                            </a>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : isLegacyOnly ? (
        <ul>
          {findings.map((f, i) => (
            <li key={`${f.rule}-${i}`} className="dz-row">
              <div className="flex items-start gap-3 px-4 py-2.5">
                <SeverityIcon severity={f.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{f.rule}</span>
                  <span className="mono-body mt-0.5 block text-[11.5px] leading-[1.5] text-label">
                    {f.detail}
                  </span>
                </span>
                <span className={`mono-label shrink-0 rounded px-2 py-[3px] text-[9.5px] ${SEVERITY_CHIP[f.severity]}`}>
                  {f.severity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Code evidence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * File / line / snippet evidence.
 *
 * The snippet is the exact matched text from the scanned artifact. Nothing is
 * reconstructed or prettified. When there is no evidence, the panel says so.
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
          No source excerpt was captured because no finding quoted a file. When a
          detector matches, the exact line it matched appears here with its path
          and line number.
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
      <div className="mono-body dz-scroll overflow-x-auto px-4 text-[11.5px] text-label">
        {evidence.file}
      </div>
      <pre className="dz-scroll mx-4 mb-4 mt-2 max-h-[220px] overflow-auto rounded-[6px] bg-[#171816] p-3 text-[11.5px] leading-[1.6] text-[#E8E6DE]">
        <code>
          {evidence.lines.map((line, i) => (
            <span key={i} className="block">
              <span className="mr-3 inline-block w-4 select-none text-right text-[#6C6E66]">{i + 1}</span>
              {line}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
