import { type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { isAllowedIconUrl } from "@/lib/tokens/sanitize";
import { iconHosts } from "@/lib/server/jupiter";

export const dynamic = "force-dynamic";

const MAX_BYTES = 300_000;

function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Token icons are fetched server-side from allowlisted hosts only, so a
 * user's IP is never sent to arbitrary hosts named in token metadata. Only
 * raster images (checked by magic bytes, never SVG) are served back.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "icon");
  if (limited) return limited;
  const url = isAllowedIconUrl(req.nextUrl.searchParams.get("u"), iconHosts());
  if (!url) return new Response(null, { status: 404 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const upstream = await fetch(url, { signal: controller.signal, redirect: "error", headers: { accept: "image/png,image/jpeg,image/webp,image/gif" } });
    if (!upstream.ok || !upstream.body) return new Response(null, { status: 404 });
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return new Response(null, { status: 404 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.byteLength;
    }
    const type = sniff(bytes);
    if (!type) return new Response(null, { status: 404 });
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400, immutable",
        "content-security-policy": "default-src 'none'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  } finally {
    clearTimeout(timer);
  }
}
