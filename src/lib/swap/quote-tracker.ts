/**
 * Guarantees that only the response to the latest request is applied.
 * Each new request aborts the previous one; a late response from a
 * superseded request is ignored even if its abort raced the network.
 */
export class LatestRequestTracker<K = string> {
  #seq = 0;
  #controller: AbortController | null = null;
  #key: K | null = null;

  begin(key: K): { id: number; signal: AbortSignal } {
    this.#controller?.abort();
    this.#seq += 1;
    this.#controller = new AbortController();
    this.#key = key;
    return { id: this.#seq, signal: this.#controller.signal };
  }

  isCurrent(id: number, key?: K): boolean {
    if (id !== this.#seq) return false;
    if (key !== undefined && key !== this.#key) return false;
    return !this.#controller?.signal.aborted;
  }

  /** Cancels any in-flight request, e.g. when the amount is cleared. */
  cancel(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#seq += 1;
    this.#key = null;
  }
}

/** Key identifying a quote request; any change invalidates an earlier quote. */
export function quoteKey(input: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number | null; network: string }): string {
  return [input.network, input.inputMint, input.outputMint, input.amount.toString(), input.slippageBps ?? "auto"].join("|");
}
