import { NextResponse, type NextRequest } from "next/server";
import { crossSiteReadGuard, rateLimit, sameOriginGuard } from "@/lib/server/guard";
import { serverEnv } from "@/lib/server/env";
import { log } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const MAX_REQUEST = 4_000_000;
const MAX_RESPONSE = 10_500_000;

/**
 * Pass-through to the Helius Privacy Rings indexer, prover and signed TEE
 * policy, adding the API key server-side. Prover requests are end-to-end
 * encrypted to an attested enclave by the SDK, so this relay sees only
 * metadata (timing, sizes, routes). Bodies are never logged or cached.
 */
async function relay(req: NextRequest, ctx: { params: Promise<{ network: string; path: string[] }> }) {
  const { network, path } = await ctx.params;
  if (network !== "mainnet" && network !== "devnet") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  // The SDK posts JSON to the indexer and encrypted octet streams to the prover enclave.
  const blocked = req.method === "POST" ? sameOriginGuard(req, { contentTypes: ["application/json", "application/octet-stream"] }) : crossSiteReadGuard(req);
  if (blocked) return blocked;
  const limited = rateLimit(req, "privacy");
  if (limited) return limited;
  const env = serverEnv();
  if (!env.HELIUS_API_KEY) return NextResponse.json({ error: "not_configured", message: "Private balances need HELIUS_API_KEY on the server." }, { status: 503 });
  if (network === "mainnet" && env.SPR_MAINNET_ENABLED !== "true") {
    return NextResponse.json({ error: "gated", message: "Mainnet private balances are disabled on this deployment." }, { status: 403 });
  }
  const [service, ...rest] = path;
  const tail = rest.map(encodeURIComponent).join("/");
  if (rest.some((seg) => seg === ".." || seg.includes("\\"))) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  let target: URL;
  if (service === "indexer" || service === "prover") {
    const baseUrl = network === "mainnet" ? (service === "indexer" ? env.SPR_INDEXER_URL_MAINNET : env.SPR_PROVER_URL_MAINNET) : service === "indexer" ? env.SPR_INDEXER_URL_DEVNET : env.SPR_PROVER_URL_DEVNET;
    target = new URL(`${baseUrl.replace(/\/+$/, "")}/${tail}`);
    for (const [k, v] of req.nextUrl.searchParams) if (k !== "api-key") target.searchParams.append(k, v);
    target.searchParams.set("api-key", env.HELIUS_API_KEY);
  } else if (service === "policy" && rest.length === 0 && req.method === "GET") {
    // Signed file; the SDK verifies it against the release signers it pins.
    target = new URL(`${env.SPR_POLICY_BASE.replace(/\/+$/, "")}/${network}.json`);
  } else {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const forward = new Headers();
  for (const [k, v] of req.headers) {
    const key = k.toLowerCase();
    if (key === "content-type" || key === "accept" || key.startsWith("spr-tee")) forward.set(k, v);
  }
  let body: ArrayBuffer | undefined;
  if (req.method === "POST") {
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_REQUEST) return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), service === "prover" ? 60_000 : 20_000);
  const started = Date.now();
  try {
    const upstream = await fetch(target, { method: req.method, headers: forward, body, signal: controller.signal, redirect: "error", cache: "no-store" });
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE) return NextResponse.json({ error: "too_large" }, { status: 502 });
    const headers = new Headers({ "cache-control": "no-store" });
    for (const [k, v] of upstream.headers) {
      const key = k.toLowerCase();
      if (key === "content-type" || key.startsWith("spr-tee")) headers.set(k, v);
    }
    log("spr_relay", { network, service, status: upstream.status, ms: Date.now() - started });
    return new Response(buf, { status: upstream.status, headers });
  } catch {
    log("spr_relay_error", { network, service, ms: Date.now() - started });
    return NextResponse.json({ error: "upstream_unreachable", message: `The ${service} service is unreachable.` }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export const GET = relay;
export const POST = relay;
