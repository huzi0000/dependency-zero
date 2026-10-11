/**
 * Small pure display helpers.
 *
 * Kept free of JSX and of any server import so the `node --test` runner can
 * exercise them directly. A crash in one of these takes down the whole React
 * tree, so they are unit tested rather than trusted.
 */

/**
 * Shorten a transaction signature for display.
 *
 * Accepts null because most attestations on a real deployment were never
 * anchored, and their stored `transactionSignature` is genuinely null — not an
 * empty string and not an error. This helper previously typed its parameter as
 * `string` and read `.length` unguarded, so rendering an unanchored attestation
 * threw a TypeError that blanked the dashboard.
 *
 * The honest thing to show for a record with no transaction is the absence.
 */
export function truncateSignature(sig: string | null | undefined): string {
  if (!sig) return "Not anchored";
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 4)}…${sig.slice(-4)}`;
}