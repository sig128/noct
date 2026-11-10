import { type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { iconCandidates, isAllowedIconUrl, normalizeIconUrl } from "@/lib/tokens/sanitize";
import { iconHosts } from "@/lib/server/jupiter";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_500_000;
/** Icons render at up to 34 px; 96 px covers high-density screens. */
const SIZE = 96;
const IMAGE_SERVICE = "https://wsrv.nl/";
const SERVICE_HOSTS = new Set(["wsrv.nl", "images.weserv.nl"]);
/** The longest one icon request may take, so a slow source never holds it for long. */
const BUDGET_MS = 9_000;
/** How long a single attempt may take. */
const ATTEMPT_MS = 4_500;
/** How long a slow attempt runs before the next one starts alongside it. */
const STAGGER_MS = 1_250;

type Image = { bytes: Uint8Array<ArrayBuffer>; type: string };
type Attempt = (signal: AbortSignal) => Promise<Image | null>;

function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Fetches an image, following at most three redirects and only to hosts
 * `allowHost` accepts. Returns raster bytes (checked by magic bytes) or null.
 */
async function fetchImage(start: URL, allowHost: (host: string) => boolean, signal: AbortSignal): Promise<Image | null> {
  const limit = AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_MS)]);
  try {
    let url = start;
    for (let hop = 0; hop <= 3; hop += 1) {
      const res = await fetch(url, { signal: limit, redirect: "manual", headers: { accept: "image/webp,image/png,image/jpeg,image/gif" } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        const next = new URL(location, url);
        if (next.protocol !== "https:" || next.username || next.password || next.port || !allowHost(next.hostname.toLowerCase())) return null;
        url = next;
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return null;
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
          return null;
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
      return type ? { bytes, type } : null;
    }
    return null;
  } catch {
    return null;
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

/**
 * Token icons, served from this origin so a user's IP never reaches the hosts
 * named in token metadata. Icons go through an image service (wsrv.nl), which
 * fetches any public https host, turns SVG and other formats into a small
 * raster and caches it; only raster bytes come back. IPFS icons are also
 * tried on other public gateways, since several that older metadata names
 * are slow or gone. If the service fails, allowlisted hosts are fetched
 * directly. Nothing but PNG, JPEG, GIF or WebP (checked by magic bytes) is
 * ever served.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "icon");
  if (limited) return limited;
  const source = normalizeIconUrl(req.nextUrl.searchParams.get("u"));
  if (!source) return new Response(null, { status: 404 });

  const candidates = iconCandidates(source).slice(0, 3);
  const hosts = iconHosts();
  const onAllowlist = (host: string) => isAllowedIconUrl(`https://${host}/`, hosts) !== null;
  const attempts: Attempt[] = [
    ...candidates.map((c): Attempt => (signal) => fetchImage(viaService(c), (host) => SERVICE_HOSTS.has(host), signal)),
    ...candidates.filter((c) => onAllowlist(c.hostname)).map((c): Attempt => (signal) => fetchImage(c, onAllowlist, signal)),
  ];
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), BUDGET_MS);
  const image = await firstImage(attempts, STAGGER_MS, controller.signal);
  clearTimeout(budget);
  // Stop any attempt still running.
  controller.abort();

  if (!image) {
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
