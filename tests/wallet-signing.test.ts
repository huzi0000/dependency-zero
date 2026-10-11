/**
 * Regression test for the wallet-signing serialisation defect.
 *
 * Reproduces the exact production path that broke real Phantom approval:
 *
 *   server: build with PublicKey.default as a stand-in fee payer, serialise
 *   client: deserialize, replace fee payer with the real wallet
 *   wallet: serialise the transaction in order to sign it
 *
 * Without clearing the placeholder signature slots, the final step throws
 *   `unknown signer: 11111111111111111111111111111111`
 * inside the wallet, before any approval prompt is shown.
 *
 * Fully offline and deterministic: no network, no wallet, no transaction.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicKey, Transaction } from "@solana/web3.js";

import { memoInstruction } from "../lib/attest/solana.ts";
import { KNOWN_GOOD_MEMO_PROGRAM_ID } from "../lib/attest/memo.ts";
import { memoPayload } from "../lib/attest/canonical.ts";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const WALLET = "HVV4demoStub1111111111111111111111111111111";
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

function memo(): string {
  return memoPayload({
    commitment: "a".repeat(64),
    scanId: "a7657ec8-221f-41e3-a5a2-da27610a9116",
    artifactSha256: "b".repeat(64),
    consensus: "review",
  });
}

/** Step 1 - exactly what prepareWalletAnchor() does on the server. */
function serverPrepare(): Buffer {
  const tx = new Transaction();
  // The placeholder that caused the defect.
  tx.feePayer = PublicKey.default;
  tx.recentBlockhash = BLOCKHASH;
  tx.lastValidBlockHeight = 200;
  tx.add(memoInstruction(memo()));
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}

/** Step 2+3 - the client rebuild, with the fix under test toggled. */
function clientRebuild(wire: Buffer, applyFix: boolean): Transaction {
  const tx = Transaction.from(Uint8Array.from(wire));
  tx.feePayer = new PublicKey(WALLET);
  if (applyFix) tx.signatures = [];
  return tx;
}

describe("wallet signing serialisation (regression)", () => {
  it("server placeholder becomes a stale signature slot on the client", () => {
    const wire = serverPrepare();
    assert.ok(wire.length > 0);

    const client = Transaction.from(Uint8Array.from(wire));
    // Confirms the mechanism: the placeholder survives the round trip.
    assert.equal(client.feePayer?.toBase58(), SYSTEM_PROGRAM);
    assert.ok(
      client.signatures.some((s) => s.publicKey.toBase58() === SYSTEM_PROGRAM),
      "the System Program is retained in the signature array",
    );

    // ...and it is NOT an account of the transaction, which is what makes it
    // an unknown signer rather than a legitimate one.
    const keys = client.instructions.flatMap((i) => [
      i.programId.toBase58(),
      ...i.keys.map((k) => k.pubkey.toBase58()),
    ]);
    assert.ok(!keys.includes(SYSTEM_PROGRAM));
  });

  it("reproduces 'unknown signer' when the wallet serialises without the fix", () => {
    const wire = serverPrepare();
    const client = clientRebuild(wire, /* applyFix */ false);

    // This is the call a wallet makes in order to compute the bytes it signs.
    assert.throws(
      () => client.serializeMessage(),
      new RegExp(`unknown signer: ${SYSTEM_PROGRAM}`),
      "without clearing the placeholder, wallet serialisation must throw",
    );
  });

  it("clearing the stale slots lets the wallet serialise the transaction", () => {
    const wire = serverPrepare();
    const client = clientRebuild(wire, /* applyFix */ true);

    const msg = client.compileMessage();
    assert.equal(msg.header.numRequiredSignatures, 1);
    assert.equal(msg.staticAccountKeys[0].toBase58(), WALLET, "wallet is the fee payer");
    assert.ok(
      msg.staticAccountKeys.some((k) => k.toBase58() === KNOWN_GOOD_MEMO_PROGRAM_ID),
      "Memo program is still in the message",
    );
    assert.ok(
      !msg.staticAccountKeys.some((k) => k.toBase58() === SYSTEM_PROGRAM),
      "System Program is not retained as an account",
    );
  });

  it("rebuilds the signature slot for the wallet instead of the placeholder", () => {
    const wire = serverPrepare();
    const client = clientRebuild(wire, /* applyFix */ true);

    // serialize() runs _compile(), which rebuilds signatures from real accounts.
    assert.throws(
      () => client.serialize(),
      /Missing signature|signature verification failed/i,
      "the transaction is awaiting the wallet signature, which is correct",
    );

    assert.equal(client.signatures.length, 1);
    assert.equal(
      client.signatures[0].publicKey.toBase58(),
      WALLET,
      "the slot is owned by the wallet, not the System Program",
    );
    assert.ok(
      !client.signatures.some((s) => s.publicKey.toBase58() === SYSTEM_PROGRAM),
      "no System Program signature slot remains",
    );
  });

  it("keeps the commitment and Memo program intact through the round trip", () => {
    const wire = serverPrepare();
    const client = clientRebuild(wire, /* applyFix */ true);
    client.compileMessage();

    assert.equal(client.instructions.length, 1);
    assert.equal(
      client.instructions[0].programId.toBase58(),
      KNOWN_GOOD_MEMO_PROGRAM_ID,
    );
    const data = Buffer.from(client.instructions[0].data).toString("utf8");
    assert.ok(data.includes("a".repeat(64)), "commitment survives serialisation");
  });
});