import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Blockhash,
} from "@solana/kit";

export async function keypair() {
  const kp = await generateKeyPair();
  return { kp, address: await getAddressFromPublicKey(kp.publicKey) };
}

/** A real v0 transaction (unsigned) invoking the given programs. */
export function unsignedTx(feePayer: string, programs: string[], extraSigner?: string): Uint8Array {
  const instructions = programs.map((p) => ({
    programAddress: address(p),
    accounts: [
      { address: address(feePayer), role: AccountRole.WRITABLE_SIGNER },
      ...(extraSigner ? [{ address: address(extraSigner), role: AccountRole.READONLY_SIGNER }] : []),
    ],
    data: new Uint8Array([1, 2, 3]),
  }));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k" as Blockhash, lastValidBlockHeight: 150n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

export async function signWith(kp: CryptoKeyPair, wire: Uint8Array): Promise<Uint8Array> {
  const tx = getTransactionDecoder().decode(wire);
  const signed = await signTransaction([kp], tx as Parameters<typeof signTransaction>[1]);
  return new Uint8Array(getTransactionEncoder().encode(signed));
}
