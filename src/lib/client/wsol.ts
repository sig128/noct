"use client";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from "@solana/kit";
import { PROGRAMS } from "@/lib/tx/programs";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";

/** Associated token account of `owner` for `mint` under the classic token program. */
export async function associatedTokenAddress(owner: string, mint: string, tokenProgram: string = PROGRAMS.token): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAMS.associatedToken),
    seeds: [enc.encode(address(owner)), enc.encode(address(tokenProgram)), enc.encode(address(mint))],
  });
  return pda;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/**
 * Wraps native SOL into the owner's wSOL token account: create the account
 * if needed (idempotent), transfer lamports, sync the token balance.
 */
export async function buildWrapSolTransaction(input: { owner: string; lamports: bigint; blockhash: string; lastValidBlockHeight: bigint }): Promise<Uint8Array> {
  const owner = address(input.owner);
  const ata = await associatedTokenAddress(input.owner, NATIVE_SOL_MINT);
  const transferData = new Uint8Array(12);
  new DataView(transferData.buffer).setUint32(0, 2, true);
  transferData.set(u64le(input.lamports), 4);
  const instructions = [
    {
      programAddress: address(PROGRAMS.associatedToken),
      accounts: [
        { address: owner, role: AccountRole.WRITABLE_SIGNER },
        { address: ata, role: AccountRole.WRITABLE },
        { address: owner, role: AccountRole.READONLY },
        { address: address(NATIVE_SOL_MINT), role: AccountRole.READONLY },
        { address: address(PROGRAMS.system), role: AccountRole.READONLY },
        { address: address(PROGRAMS.token), role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    {
      programAddress: address(PROGRAMS.system),
      accounts: [
        { address: owner, role: AccountRole.WRITABLE_SIGNER },
        { address: ata, role: AccountRole.WRITABLE },
      ],
      data: transferData,
    },
    {
      programAddress: address(PROGRAMS.token),
      accounts: [{ address: ata, role: AccountRole.WRITABLE }],
      data: new Uint8Array([17]),
    },
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: input.blockhash as Blockhash, lastValidBlockHeight: input.lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** Closes the owner's wSOL account, returning every lamport (balance and rent) as native SOL. */
export async function buildUnwrapSolTransaction(input: { owner: string; blockhash: string; lastValidBlockHeight: bigint }): Promise<Uint8Array> {
  const owner = address(input.owner);
  const ata = await associatedTokenAddress(input.owner, NATIVE_SOL_MINT);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: input.blockhash as Blockhash, lastValidBlockHeight: input.lastValidBlockHeight }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address(PROGRAMS.token),
            accounts: [
              { address: ata, role: AccountRole.WRITABLE },
              { address: owner, role: AccountRole.WRITABLE },
              { address: owner, role: AccountRole.READONLY_SIGNER },
            ],
            data: new Uint8Array([9]),
          },
        ],
        m,
      ),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}
