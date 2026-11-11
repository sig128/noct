import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { UpstreamError } from "./http";
import { serverEnv } from "./env";
import { log } from "./log";

interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * Per-instance token buckets keyed by client IP and route class. Budgets are
 * sized to upstream cost: quotes are cheap, assembled orders and proofs are not.
 * A multi-instance deployment needs a shared store; see docs/security-assumptions.md.
 */
const BUDGETS = {
  read: { capacity: 60, refillPerSec: 2 },
  quote: { capacity: 20, refillPerSec: 1 },
  // Room for one order and one execute per NOCT wallet (up to ten) in a batch.
  order: { capacity: 12, refillPerSec: 0.3 },
  execute: { capacity: 12, refillPerSec: 0.3 },
  rpc: { capacity: 120, refillPerSec: 6 },
  privacy: { capacity: 120, refillPerSec: 4 },
  icon: { capacity: 200, refillPerSec: 10 },
} as const;

export type BudgetClass = keyof typeof BUDGETS;

const buckets = new Map<string, Bucket>();

function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}

export function rateLimit(req: NextRequest, cls: BudgetClass): NextResponse | null {
  const budget = BUDGETS[cls];
  const key = `${cls}:${clientKey(req)}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: budget.capacity, updated: now };
  bucket.tokens = Math.min(budget.capacity, bucket.tokens + ((now - bucket.updated) / 1000) * budget.refillPerSec);
  bucket.updated = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfter = Math.ceil((1 - bucket.tokens) / budget.refillPerSec);
    log("rate_limited", { cls });
    return NextResponse.json({ error: "rate_limited", message: "Too many requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 50_000) buckets.clear();
  return null;
}

/**
 * CSRF / cross-origin defence for state-changing endpoints: the request must
 * come from this origin (or an explicitly allowlisted one) and carry JSON.
 */
export function sameOriginGuard(req: NextRequest, opts: { contentTypes?: readonly string[] } = {}): NextResponse | null {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const host = req.headers.get("host");
  const allowed = new Set((serverEnv().NOCT_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  let originOk = false;
  if (origin) {
    try {
      const o = new URL(origin);
      originOk = o.host === host || allowed.has(o.origin);
    } catch {
      originOk = false;
    }
  }
  if (!originOk || (site && site !== "same-origin" && !allowed.has(origin ?? ""))) {
    log("cross_origin_blocked");
    return NextResponse.json({ error: "forbidden", message: "Cross-origin requests are not accepted." }, { status: 403 });
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const accepted = opts.contentTypes ?? ["application/json"];
  if (req.method === "POST" && !accepted.some((t) => ct.startsWith(t))) {
    return NextResponse.json({ error: "unsupported_media_type", message: `Send ${accepted.join(" or ")}.` }, { status: 415 });
  }
  return null;
}

/**
 * For keyed read relays: refuse requests a browser marks as cross-site, so
 * other sites cannot spend this deployment's provider quota through visitors.
 * Non-browser clients are bounded by the rate limits instead.
 */
export function crossSiteReadGuard(req: NextRequest): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    log("cross_site_read_blocked");
    return NextResponse.json({ error: "forbidden", message: "Cross-site requests are not accepted." }, { status: 403 });
  }
  return null;
}

export async function readJsonBody(req: NextRequest, maxBytes = 64_000): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new BodyError("Request body too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new BodyError("Request body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError("Malformed JSON");
  }
}

export class BodyError extends Error {}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof BodyError) return NextResponse.json({ error: "bad_request", message: error.message }, { status: 400 });
  if (error instanceof UpstreamError) {
    const status = error.code === "timeout" ? 504 : error.code === "network" ? 502 : error.code === "invalid_schema" ? 502 : error.status && error.status < 500 ? error.status : 502;
    return NextResponse.json({ error: `upstream_${error.code}`, service: error.service, message: error.message }, { status });
  }
  log("internal_error", { name: (error as Error)?.name ?? "unknown" });
  return NextResponse.json({ error: "internal", message: "Something went wrong on the server." }, { status: 500 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}
