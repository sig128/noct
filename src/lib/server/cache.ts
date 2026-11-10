import "server-only";

/**
 * Tiny TTL cache for PUBLIC market data only (token search, prices, markets).
 * Nothing user-specific or private may be stored here.
 */
export class TtlCache<V> {
  readonly #entries = new Map<string, { value: V; expires: number }>();
  constructor(
    readonly ttlMs: number,
    readonly maxEntries = 500,
  ) {}

  get(key: string): V | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.#entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

/** Coalesces concurrent identical upstream requests. */
export class Inflight<V> {
  readonly #pending = new Map<string, Promise<V>>();
  run(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.#pending.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.#pending.delete(key));
    this.#pending.set(key, p);
    return p;
  }
}
