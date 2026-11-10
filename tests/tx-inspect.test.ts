import { describe, expect, it } from "vitest";
import { checkTransactionPolicy, inspectTransactionBytes, transactionSignatureBytes, TransactionDecodeError } from "@/lib/tx/inspect";
import { PROGRAMS, ROUTER_PROGRAMS, EARN_PROGRAMS } from "@/lib/tx/programs";
import { keypair, signWith, unsignedTx } from "./helpers/tx";

describe("transaction inspection before signing", () => {
  it("reads version, fee payer, required signers and top-level programs", async () => {
    const { address: payer } = await keypair();
    const tx = inspectTransactionBytes(unsignedTx(payer, [PROGRAMS.computeBudget, PROGRAMS.jupiterAggregatorV6]));
    expect(tx.version).toBe(0);
    expect(tx.feePayer).toBe(payer);
    expect(tx.requiredSigners).toEqual([payer]);
    expect(tx.programs).toEqual([PROGRAMS.computeBudget, PROGRAMS.jupiterAggregatorV6]);
    expect(tx.presignedBy).toEqual([]);
  });

  it("passes a router transaction that only invokes allowed programs", async () => {
    const { address: payer } = await keypair();
    const tx = inspectTransactionBytes(unsignedTx(payer, [PROGRAMS.computeBudget, PROGRAMS.associatedToken, PROGRAMS.jupiterAggregatorV6]));
    expect(checkTransactionPolicy(tx, { feePayer: payer, allowedPrograms: ROUTER_PROGRAMS.metis!, allowedVersions: [0] }).ok).toBe(true);
  });

  it("blocks unknown programs, foreign fee payers and unexpected co-signers", async () => {
    const { address: payer } = await keypair();
    const { address: other } = await keypair();
    const drainer = "Vote111111111111111111111111111111111111111";
    const withDrainer = inspectTransactionBytes(unsignedTx(payer, [PROGRAMS.jupiterAggregatorV6, drainer]));
    const r1 = checkTransactionPolicy(withDrainer, { feePayer: payer, allowedPrograms: ROUTER_PROGRAMS.metis! });
    expect(r1.ok).toBe(false);
    expect(r1.unknownPrograms).toEqual([drainer]);

    const foreignPayer = inspectTransactionBytes(unsignedTx(other, [PROGRAMS.jupiterLendLending], payer));
    expect(checkTransactionPolicy(foreignPayer, { feePayer: payer, allowedPrograms: EARN_PROGRAMS }).violations.join(" ")).toMatch(/unexpected account pays/);

    const coSigned = inspectTransactionBytes(unsignedTx(payer, [PROGRAMS.jupiterLendLending], other));
    expect(checkTransactionPolicy(coSigned, { feePayer: payer, allowedPrograms: EARN_PROGRAMS }).ok).toBe(false);
    expect(checkTransactionPolicy(coSigned, { feePayer: payer, allowedPrograms: EARN_PROGRAMS, allowedCoSigners: [other] }).ok).toBe(true);
  });

  it("extracts the fee payer's signature only from a signed transaction", async () => {
    const { kp, address: payer } = await keypair();
    const wire = unsignedTx(payer, [PROGRAMS.system]);
    expect(() => transactionSignatureBytes(wire)).toThrow(TransactionDecodeError);
    const signed = await signWith(kp, wire);
    expect(transactionSignatureBytes(signed)).toHaveLength(64);
    expect(inspectTransactionBytes(signed).presignedBy).toEqual([payer]);
  });

  it("rejects garbage bytes", () => {
    expect(() => inspectTransactionBytes(new Uint8Array([1, 2, 3]))).toThrow(TransactionDecodeError);
  });
});
