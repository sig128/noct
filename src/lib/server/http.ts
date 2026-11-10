import "server-only";
import type { ZodType } from "zod";
import { log } from "./log";

export class UpstreamError extends Error {
  constructor(
    readonly code: "timeout" | "network" | "status" | "too_large" | "invalid_body" | "invalid_schema",
    readonly service: string,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface UpstreamOptions {
  service: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Retries apply to GET only (idempotent). */
  retries?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

/** Removes credentials from URLs before they reach logs or error messages. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (/key|token|secret|auth/i.test(key)) u.searchParams.set(key, "REDACTED");
    }
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return "invalid-url";
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch with timeout, bounded size, bounded retries with jittered backoff, and no secret leakage. */
export async function upstreamJson(url: string, opts: UpstreamOptions): Promise<{ status: number; data: unknown }> {
  const method = opts.method ?? "GET";
  const retries = method === "GET" ? (opts.retries ?? 1) : 0;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let attempt = 0;
  const started = Date.now();
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        method,
        headers: { accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      let text: string;
      try {
        text = await readLimited(response, maxBytes);
      } catch {
        throw new UpstreamError("too_large", opts.service, "Upstream response exceeded the size limit");
      }
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new UpstreamError("invalid_body", opts.service, "Upstream returned malformed JSON", response.status);
        }
      }
      const retriable = response.status === 429 || response.status >= 500;
      if (retriable && attempt < retries) {
        attempt += 1;
        await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 120));
        continue;
      }
      log("upstream", { service: opts.service, status: response.status, ms: Date.now() - started, attempt });
      return { status: response.status, data };
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      const timedOut = controller.signal.aborted && !opts.signal?.aborted;
      if (attempt < retries && !opts.signal?.aborted) {
        attempt += 1;
        await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 120));
        continue;
      }
      log("upstream_error", { service: opts.service, code: timedOut ? "timeout" : "network", ms: Date.now() - started });
      throw new UpstreamError(timedOut ? "timeout" : "network", opts.service, timedOut ? `${opts.service} timed out` : `${opts.service} is unreachable`);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function parseWith<T>(schema: ZodType<T>, data: unknown, service: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new UpstreamError("invalid_schema", service, `${service} response failed validation at ${first?.path.join(".") || "root"}`);
  }
  return result.data;
}
