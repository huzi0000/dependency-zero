/**
 * Render the real signature, or an explicit "not anchored".
 *
 * Attestations are stored before anchoring succeeds, so a null signature is a
 * normal state: it means the commitment exists but was never anchored. That
 * must read as such, never as a truncated string or a fabricated link.
 */
import { Fragment } from "react";

export function AttestationSignature({
  signature,
  className = "mono-body block text-[11.5px] text-label",
}: {
  signature: string | null;
  className?: string;
}) {
  if (!signature) {
    return <span className={className}>not anchored on Solana Devnet</span>;
  }
  return (
    <span className={className}>
      {signature.slice(0, 4)}…{signature.slice(-4)}
    </span>
  );
}

/** Shorten a signature for a copy control, or return null when unanchored. */
export function signatureDisplay(signature: string | null): string | null {
  return signature ? `${signature.slice(0, 4)}…${signature.slice(-4)}` : null;
}