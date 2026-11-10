import { type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { createHash, timingSafeEqual } from "node:crypto";
import { iconCandidates, iconSpelling, ipfsContent, isAllowedIconUrl, normalizeIconUrl, rawBlockDigest } from "@/lib/tokens/sanitize";
import { iconHosts } from "@/lib/server/jupiter";
import { log } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_500_000;
/** Icons render at up to 34 px; 96 px covers high-density screens. */
const SIZE = 96;
const IMAGE_SERVICE = "https://wsrv.nl/";
const SERVICE_HOSTS = new Set(["wsrv.nl", "images.weserv.nl"]);
/**
 * Helius's image cache, in the form its DAS API gives as `cdn_uri`: the
 * metadata URL appended to this prefix. It often still holds icons whose
 * IPFS gateways refuse or rate-limit requests from shared server addresses.
 */
const HELIUS_CDN = "https://cdn.helius-rpc.com/cdn-cgi/image//";
const HELIUS_CDN_HOST = "cdn.helius-rpc.com";
/**
 * IPFS's trustless gateway: it returns content blocks, which are checked
 * against the content id here, so the gateway does not have to be trusted.
 * Used for single-block (raw) IPFS icons.
 */
const TRUSTLESS_GATEWAY = "https://trustless-gateway.link/ipfs/";
const TRUSTLESS_HOST = "trustless-gateway.link";
const IMAGE_ACCEPT = "image/webp,image/png,image/jpeg,image/gif";
/** The longest one icon request may take, so a slow source never holds it for long. */
const BUDGET_MS = 9_000;
/** How long a single attempt may take. */
const ATTEMPT_MS = 4_500;
/** How long a slow attempt runs before the next one starts alongside it. */
const STAGGER_MS = 1_250;

type Image = { bytes: Uint8Array<ArrayBuffer>; type: string };
/** An image, or a short reason the attempt failed (for the operations log). */
type Outcome = Image | string;
type Attempt = (signal: AbortSignal) => Promise<Image | null>;

function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Fetches a response body of at most MAX_BYTES, following at most three
 * redirects and only to hosts `allowHost` accepts. Returns the bytes or why not.
 */
async function fetchBytes(start: URL, allowHost: (host: string) => boolean, signal: AbortSignal, accept: string): Promise<Uint8Array<ArrayBuffer> | string> {
  const limit = AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_MS)]);
  try {
    let url = start;
    for (let hop = 0; hop <= 3; hop += 1) {
      const res = await fetch(url, { signal: limit, redirect: "manual", headers: { accept } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return `${res.status} without location`;
        const next = new URL(location, url);
        if (next.protocol !== "https:" || next.username || next.password || next.port || !allowHost(next.hostname.toLowerCase())) return `redirect to ${next.hostname} refused`;
        url = next;
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return String(res.status);
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          return "too large";
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      return bytes;
    }
    return "too many redirects";
  } catch {
    return signal.aborted ? "stopped" : limit.aborted ? "timed out" : "network error";
  }
}

function asImage(bytes: Uint8Array<ArrayBuffer> | string): Outcome {
  if (typeof bytes === "string") return bytes;
  const type = sniff(bytes);
  return type ? { bytes, type } : "not a raster image";
}

/** An image (raster, checked by magic bytes) or why not. */
async function fetchImage(start: URL, allowHost: (host: string) => boolean, signal: AbortSignal): Promise<Outcome> {
  return asImage(await fetchBytes(start, allowHost, signal, IMAGE_ACCEPT));
}

/** A single-block IPFS file from the trustless gateway, accepted only if it hashes to its content id. */
async function fetchVerifiedBlock(cid: string, digest: Uint8Array, signal: AbortSignal): Promise<Outcome> {
  const bytes = await fetchBytes(new URL(`${TRUSTLESS_GATEWAY}${cid}?format=raw`), (host) => host === TRUSTLESS_HOST, signal, "application/vnd.ipld.raw");
  if (typeof bytes === "string") return bytes;
  const actual = createHash("sha256").update(bytes).digest();
  if (actual.byteLength !== digest.byteLength || !timingSafeEqual(actual, digest)) return "content does not match its id";
  return asImage(bytes);
}

/**
 * Runs the attempts in order and resolves with the first image. A slow
 * attempt does not hold up the rest: the next one starts as soon as the
 * previous fails, or after `staggerMs` while it is still running. Resolves
 * null when every attempt fails or `signal` aborts.
 */
function firstImage(attempts: Attempt[], staggerMs: number, signal: AbortSignal): Promise<Image | null> {
  return new Promise((resolve) => {
    let started = 0;
    let settled = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (image: Image | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(image);
    };
    const startNext = () => {
      clearTimeout(timer);
      if (done) return;
      if (started === attempts.length) {
        if (settled === started) finish(null);
        return;
      }
      const attempt = attempts[started]!;
      started += 1;
      attempt(signal)
        .catch(() => null)
        .then((image) => {
          settled += 1;
          if (image) finish(image);
          else startNext();
        });
      if (started < attempts.length) timer = setTimeout(startNext, staggerMs);
    };
    if (signal.aborted) return finish(null);
    signal.addEventListener("abort", () => finish(null), { once: true });
    startNext();
  });
}

function viaService(source: URL): URL {
  const url = new URL(IMAGE_SERVICE);
  url.searchParams.set("url", source.toString());
  url.searchParams.set("w", String(SIZE));
  url.searchParams.set("h", String(SIZE));
  url.searchParams.set("fit", "cover");
  url.searchParams.set("output", "webp");
  return url;
}

/** A gateway host without the IPFS content id in front, to keep log lines short. */
function shortHost(url: URL): string {
  return url.hostname.replace(/^[a-z0-9]{40,}\.ipfs\./, "ipfs.");
}

/**
 * Token icons, served from this origin so a user's IP never reaches the hosts
 * named in token metadata. Icons go through an image service (wsrv.nl), which
 * fetches any public https host, turns SVG and other formats into a small
 * raster and caches it; only raster bytes come back. When that fails, the
 * icon is taken from Helius's image cache, then (for IPFS) from the trustless
 * gateway with the content checked against its id, then from other public
 * gateways, then directly from allowlisted hosts. Nothing but PNG, JPEG, GIF
 * or WebP (checked by magic bytes) is ever served.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "icon");
  if (limited) return limited;
  const raw = req.nextUrl.searchParams.get("u");
  const source = normalizeIconUrl(raw);
  if (!source) return new Response(null, { status: 404 });

  const candidates = iconCandidates(source).slice(0, 4);
  const [named, ...gateways] = candidates;
  const cached = new URL(`${HELIUS_CDN}${iconSpelling(raw, source)}`);
  const ipfs = ipfsContent(source);
  const digest = ipfs && (ipfs.path === "" || ipfs.path === "/") ? rawBlockDigest(ipfs.cid) : null;
  const hosts = iconHosts();
  const onAllowlist = (host: string) => isAllowedIconUrl(`https://${host}/`, hosts) !== null;
  const failures: string[] = [];
  let served = "";
  const attempt =
    (label: string, run: (signal: AbortSignal) => Promise<Outcome>): Attempt =>
    async (signal) => {
      const startedAt = Date.now();
      const outcome = await run(signal);
      if (typeof outcome !== "string") {
        served ||= `${label} after ${Date.now() - startedAt} ms`;
        return outcome;
      }
      failures.push(`${label}: ${outcome} after ${Date.now() - startedAt} ms`);
      return null;
    };
  const resized = (label: string, url: URL) => attempt(`service ${label}`, (signal) => fetchImage(viaService(url), (host) => SERVICE_HOSTS.has(host), signal));
  const attempts: Attempt[] = [
    resized(shortHost(named!), named!),
    // The image service cannot fetch the cache's URLs, so it is asked directly.
    attempt("helius cdn", (signal) => fetchImage(cached, (host) => host === HELIUS_CDN_HOST, signal)),
    ...(ipfs && digest ? [attempt("trustless gateway", (signal) => fetchVerifiedBlock(ipfs.cid, digest, signal))] : []),
    ...gateways.map((c) => resized(shortHost(c), c)),
    ...candidates.filter((c) => onAllowlist(c.hostname)).map((c) => attempt(`direct ${shortHost(c)}`, (signal) => fetchImage(c, onAllowlist, signal))),
  ];
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), BUDGET_MS);
  const image = await firstImage(attempts, STAGGER_MS, controller.signal);
  clearTimeout(budget);
  // Stop any attempt still running.
  controller.abort();

  // Hosts and statuses only: which icon a person looked at is not logged.
  const tried = Object.fromEntries(failures.map((f, i) => [`failed${i + 1}`, f]));
  if (image && failures.length > 0) log("icon.fallback", { served, ...tried });
  if (!image) {
    log("icon.miss", tried);
    // Cache misses briefly so a missing icon does not hit the upstream on every view.
    return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=300, s-maxage=600" } });
  }
  return new Response(image.bytes, {
    status: 200,
    headers: {
      "content-type": image.type,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}
