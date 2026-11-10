import "server-only";

type Field = string | number | boolean | null | undefined;

/** Keys that must never appear in logs, whatever a caller passes. */
const FORBIDDEN = /amount|balance|address|wallet|taker|signer|recipient|mint|signature|key|secret|seed|note|utxo|terms/i;

/**
 * Operational log line: event code, status and latency only. Private amounts,
 * addresses, note openings and loan terms are dropped by key.
 */
export function logLine(event: string, fields: Record<string, Field> = {}): string {
  const safe: Record<string, Field> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN.test(k)) continue;
    safe[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  return JSON.stringify({ t: new Date().toISOString(), event, ...safe });
}

export function log(event: string, fields: Record<string, Field> = {}): void {
  if (process.env.NOCT_SILENT_LOGS === "1") return;
  console.info(logLine(event, fields));
}
