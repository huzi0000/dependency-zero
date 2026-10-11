/**
 * Admission rule for recording a wallet-anchored transaction.
 *
 * This is a security decision, so it lives in its own portable module rather
 * than inline in a route handler: it imports nothing, touches no store and no
 * Solana client, and can therefore be exercised directly by the test suite.
 */

/** What the server should do with an incoming transaction signature. */
export type AnchorAdmission =
  /** Not yet confirmed — record it and verify against Devnet. */
  | "new"
  /** Already confirmed with this exact signature — reconcile, do not re-anchor. */
  | "idempotent"
  /** Already confirmed with a DIFFERENT signature — refuse with 409. */
  | "conflict";

/** The minimum shape needed to make the decision. */
export interface AnchorAdmissionInput {
  confirmed: boolean;
  transactionSignature?: string | null;
}

export interface AnchorAdmissionResult {
  admission: AnchorAdmission;
  /** Populated only for "conflict"; the signature that must not be replaced. */
  existingSignature?: string;
}

/**
 * Decide whether an incoming signature may be recorded.
 *
 * WHY A CONFIRMED RECORD MAY NOT BE REPOINTED
 *
 * Re-anchoring a confirmed scan at a different transaction would orphan the
 * original anchor: the Devnet transaction everyone was told to verify would
 * stop being the one this record describes, while the new transaction exists on
 * chain with nothing pointing at it. Proof already published to a third party
 * would silently stop matching the record. So the record is left untouched and
 * the caller is expected to answer 409.
 *
 * Re-posting the SAME signature stays idempotent, so a browser refresh, a
 * double click or a retried request still reconciles the existing anchor rather
 * than failing or creating a second one.
 *
 * Note the asymmetry: an unconfirmed record accepts any signature. That is safe
 * because nothing has been published yet and the incoming signature is verified
 * against Devnet before it is ever marked confirmed.
 */
export function classifyAnchorSubmission(
  attestation: AnchorAdmissionInput,
  incomingSignature: string,
): AnchorAdmissionResult {
  const existing = attestation.transactionSignature ?? null;

  if (!attestation.confirmed || !existing) {
    return { admission: "new" };
  }

  if (existing === incomingSignature) {
    return { admission: "idempotent", existingSignature: existing };
  }

  return { admission: "conflict", existingSignature: existing };
}