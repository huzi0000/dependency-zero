import { NextResponse } from "next/server";

import { getAttestation, saveAttestation } from "@/lib/store";
import { recordWalletAnchor } from "@/lib/attest/wallet-flow";
import { classifyAnchorSubmission } from "@/lib/attest/anchor-policy";
import { MECHANISM_LABEL } from "@/lib/attest/memo";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Record a wallet-signed, wallet-broadcast transaction.
 *
 * The signature is NOT trusted. It is fetched from Devnet, checked for success,
 * checked for the expected Memo program, and its commitment compared against a
 * locally recomputed hash. Only then is the attestation marked confirmed.
 *
 * AUTHORISATION
 *
 * Knowing a scan id is not authorisation. Anyone can enumerate ids and post a
 * signature at this endpoint, so a caller must additionally prove that it
 * obtained the transaction for THIS scan: the on-chain memo payload is decoded
 * and must carry this scan's id and a commitment that matches the locally
 * recomputed one. A caller with no signature at all cannot get in.
 *
 * This is a cryptographic authorisation, not an identity check. It stops an
 * unrelated transaction being pasted onto a record; it does not decide *who* is
 * allowed to anchor. See `docs/DEPLOYMENT.md` for what remains open.
 *
 * Idempotent: re-recording the same signature re-verifies rather than creating a
 * second attestation, so a refresh or a double submit cannot anchor twice.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const limiter = checkRateLimit(request, { scope: "attest-record", limit: 10, windowMs: 60_000 });
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: "Too many anchoring attempts. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(limiter) },
    );
  }

  let body: { signature?: unknown };
  try {
    body = (await request.json()) as { signature?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!signature || signature.length < 80 || signature.length > 90) {
    return NextResponse.json(
      { error: "A valid transaction signature is required." },
      { status: 400 },
    );
  }

  const stored = await getAttestation(id);
  if (!stored) {
    return NextResponse.json(
      { error: "No attestation evidence exists for this scan." },
      { status: 404 },
    );
  }

  /**
   * Admission is decided by a pure, unit-tested policy so the rule cannot drift
   * from the code that enforces it: a confirmed record may be reconciled with
   * the same signature, but never re-pointed at a different transaction.
   */
  const admission = classifyAnchorSubmission(stored.attestation, signature);
  const isSameAsExisting = admission.admission === "idempotent";

  if (admission.admission === "conflict") {
    return NextResponse.json(
      {
        error:
          "This scan is already anchored and confirmed with a different transaction. " +
          "Re-anchoring would orphan the existing proof.",
        existingSignature: admission.existingSignature,
        existingExplorerUrl: stored.attestation.explorerUrl,
      },
      { status: 409 },
    );
  }

  const result = await recordWalletAnchor(stored, signature);

  const nextStatus: "confirmed" | "submitted" | "failed" =
    result.status === "confirmed"
      ? "confirmed"
      : result.status === "pending"
        ? "submitted"
        : "failed";

  const attestation = {
    ...stored.attestation,
    schemaVersion: "d0-attestation/1",
    mechanism: "spl-memo-wallet",
    mechanismLabel: MECHANISM_LABEL,
    cluster: "devnet",
    commitmentHash: stored.bundle.commitment,
    scanId: id,
    artifactSha256: stored.bundle.scan.artifactSha256,
    status: nextStatus,
    transactionSignature: result.signature ?? signature,
    slot: result.slot,
    confirmationStatus: result.confirmationStatus,
    blockTime: result.blockTime,
    explorerUrl: result.explorerUrl,
    submittedAt: stored.attestation.submittedAt ?? new Date().toISOString(),
    confirmedAt: result.status === "confirmed" ? new Date().toISOString() : null,
    // Never true before independent verification said so.
    confirmed: result.status === "confirmed",
    error: result.error,
    memoData: stored.bundle.memoData,
    memoProgramId: stored.bundle.expectedMemoProgramId,
    idempotencyKey: stored.attestation.idempotencyKey || signature.slice(0, 32),
  };

  await saveAttestation({
    ...stored,
    attestation,
    /**
     * Keep the bundle's embedded attestation identical to the stored one.
     *
     * The bundle is the portable artefact a third party verifies, and the
     * verifier reads the transaction reference from `bundle.attestation`. When
     * these two drifted apart, an exported bundle for a genuinely anchored scan
     * reported NOT_ATTESTED because its embedded copy still said not_started.
     *
     * Only the attestation block is synced. `commitment`, `scanners`,
     * `consensus` and `memoData` are never touched here, so no signature,
     * finding or commitment is rewritten by recording a transaction.
     */
    bundle: { ...stored.bundle, attestation },
    verification: {
      status: result.status.toUpperCase(),
      checkedAt: new Date().toISOString(),
      anchoredCommitment: result.anchoredCommitment,
      slot: result.slot,
      error: result.error,
    },
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    status: result.status,
    reconciledExisting: isSameAsExisting,
    signature: result.signature,
    explorerUrl: result.explorerUrl,
    slot: result.slot,
    blockTime: result.blockTime,
    confirmationStatus: result.confirmationStatus,
    anchoredCommitment: result.anchoredCommitment,
    commitmentMatches: result.commitmentMatches,
    expectedCommitment: stored.bundle.commitment,
    error: result.error,
  });
}