import { describe, expect, it } from "vitest";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { compareWalletChanges } from "@/lib/tx/wallet-changes";
import { PROGRAMS } from "@/lib/tx/programs";

const PAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const POOL_STATE = "DRiP2Pn2K6fuMLKQmt5rZWyHiUZ6WK3GChEySUpHSS4x";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k" as Blockhash;

function ix(program: string, data: number[], accounts: { address: string; role: AccountRole }[] = [{ address: PAYER, role: AccountRole.WRITABLE_SIGNER }, { address: POOL_STATE, role: AccountRole.WRITABLE }]): Instruction {
  return { programAddress: address(program), accounts: accounts.map((a) => ({ address: address(a.address), role: a.role })), data: new Uint8Array(data) };
}

const pool = (data = [1, 2, 3]) => ix(PROGRAMS.privacyRingsPool, data);
const lighthouse = () => ix(PROGRAMS.lighthouse, [9, 9], [{ address: PAYER, role: AccountRole.READONLY }]);

function tx(version: 0 | 1, instructions: Instruction[], options: { payer?: string; blockhash?: Blockhash; computeUnits?: number } = {}): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(address(options.payer ?? PAYER), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: options.blockhash ?? BLOCKHASH, lastValidBlockHeight: 150n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => (options.computeUnits ? setTransactionMessageComputeUnitLimit(options.computeUnits, m) : m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message as Parameters<typeof compileTransaction>[0])));
}

describe("what a wallet changed after review", () => {
  for (const version of [0, 1] as const) {
    it(`accepts safety checks the wallet added before or after the reviewed instructions (v${version})`, () => {
      const reviewed = tx(version, [pool()]);
      for (const signed of [tx(version, [pool(), lighthouse()]), tx(version, [lighthouse(), pool()])]) {
        const changes = compareWalletChanges(reviewed, signed);
        expect(changes.problems).toEqual([]);
        expect(changes.acceptable).toBe(true);
        expect(changes.addedPrograms).toEqual([PROGRAMS.lighthouse]);
      }
    });

    it(`accepts fee settings the wallet adjusted (v${version})`, () => {
      const changes = compareWalletChanges(tx(version, [pool()]), tx(version, [pool()], { computeUnits: 400_000 }));
      expect(changes.acceptable).toBe(true);
      expect(changes.feeSettingsChanged).toBe(true);
    });

    it(`refuses anything else and says what changed (v${version})`, () => {
      const reviewed = tx(version, [pool()]);
      const unknown = compareWalletChanges(reviewed, tx(version, [pool(), ix(OTHER, [1])]));
      expect(unknown.acceptable).toBe(false);
      expect(unknown.problems.join("; ")).toMatch(/added or changed an instruction for Unrecognised program 9WzD…AWWM/);

      const altered = compareWalletChanges(reviewed, tx(version, [pool([1, 2, 4])]));
      expect(altered.acceptable).toBe(false);
      expect(altered.problems.join("; ")).toMatch(/Privacy Rings shielded pool/);

      expect(compareWalletChanges(reviewed, tx(version, [lighthouse()])).problems.join("; ")).toMatch(/removed or changed an instruction for Privacy Rings shielded pool/);
      expect(compareWalletChanges(reviewed, tx(version, [pool()], { payer: OTHER })).problems).toContain("it changed who pays the fee");
      expect(compareWalletChanges(reviewed, tx(version, [pool()], { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as Blockhash })).problems).toContain("it changed the recent blockhash");
    });
  }

  it("refuses a change to a transaction another party had already signed", () => {
    const withCoSigner = (extra: Instruction[]) => {
      const wire = tx(0, [ix(PROGRAMS.privacyRingsPool, [1], [{ address: PAYER, role: AccountRole.WRITABLE_SIGNER }, { address: OTHER, role: AccountRole.READONLY_SIGNER }]), ...extra]);
      const decoded = getTransactionDecoder().decode(wire);
      const signatures = { ...(decoded.signatures as Record<string, Uint8Array | null>), [OTHER]: new Uint8Array(64).fill(7) };
      return new Uint8Array(getTransactionEncoder().encode({ ...decoded, signatures } as never));
    };
    const changes = compareWalletChanges(withCoSigner([]), withCoSigner([lighthouse()]));
    expect(changes.acceptable).toBe(false);
    expect(changes.problems).toContain("another party had already signed it, and their signature no longer matches");
  });
});
