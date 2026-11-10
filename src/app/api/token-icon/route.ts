import { type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { iconSpelling, ipfsContent, ipfsGatewayUrl, isAllowedIconUrl, normalizeIconUrl } from "@/lib/tokens/sanitize";
import { serverEnv } from "@/lib/server/env";
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
 * hosts refuse or rate-limit requests from shared server addresses.
 */
const HELIUS_CDN = "https://cdn.helius-rpc.com/cdn-cgi/image//";
const HELIUS_CDN_HOST = "cdn.helius-rpc.com";
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
 * Fetches an image of at most MAX_BYTES, following at most three redirects
 * and only to hosts `allowHost` accepts. Returns raster bytes (checked by
 * magic bytes) or why not.
 */
async function fetchImage(start: URL, allowHost: (host: string) => boolean, signal: AbortSignal): Promise<Outcome> {
  const limit = AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_MS)]);
  try {
    let url = start;
    for (let hop = 0; hop <= 3; hop += 1) {
      const res = await fetch(url, { signal: limit, redirect: "manual", headers: { accept: IMAGE_ACCEPT } });
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
      const type = sniff(bytes);
      return type ? { bytes, type } : "not a raster image";
    }
    return "too many redirects";
  } catch {
    return signal.aborted ? "stopped" : limit.aborted ? "timed out" : "network error";
  }
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
 * raster and caches it; only raster bytes come back. When that fails, IPFS
 * icons are taken from the deployment's own IPFS gateway if one is set
 * (public gateways rate-limit servers), then any icon from Helius's image
 * cache, then directly from allowlisted hosts. Nothing but PNG, JPEG, GIF or
 * WebP (checked by magic bytes) is ever served.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "icon");
  if (limited) return limited;
  const raw = req.nextUrl.searchParams.get("u");
  const source = normalizeIconUrl(raw);
  if (!source) return new Response(null, { status: 404 });

  const cached = new URL(`${HELIUS_CDN}${iconSpelling(raw, source)}`);
  const ipfs = ipfsContent(source);
  const template = serverEnv().NOCT_IPFS_GATEWAY;
  const own = ipfs && template ? ipfsGatewayUrl(template, ipfs) : null;
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
  const attempts: Attempt[] = [
    attempt(`service ${shortHost(source)}`, (signal) => fetchImage(viaService(source), (host) => SERVICE_HOSTS.has(host), signal)),
    // Fetched directly: the gateway is the operator's, and its URL may carry a token.
    ...(own ? [attempt("own ipfs gateway", (signal) => fetchImage(own, (host) => host === own.hostname || host.endsWith(`.${own.hostname}`), signal))] : []),
    // The image service cannot fetch the cache's URLs, so it is asked directly.
    attempt("helius cdn", (signal) => fetchImage(cached, (host) => host === HELIUS_CDN_HOST, signal)),
    ...(onAllowlist(source.hostname) ? [attempt(`direct ${shortHost(source)}`, (signal) => fetchImage(source, onAllowlist, signal))] : []),
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
