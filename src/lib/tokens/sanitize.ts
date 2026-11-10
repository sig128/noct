/**
 * Token metadata is attacker-controlled. These helpers strip characters that
 * can spoof or reorder rendered text, and bound lengths so names cannot break
 * layouts. Output is still rendered as text nodes only, never as HTML.
 */

// Bidi overrides/isolates, zero-width and other invisible formatting characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￸]/g;

export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  const cleaned = input.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(cleaned);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("")}…` : cleaned;
}

export function sanitizeSymbol(input: unknown): string {
  return sanitizeText(input, 16) || "UNKNOWN";
}

export function sanitizeName(input: unknown): string {
  return sanitizeText(input, 64) || "Unnamed token";
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isLikelySolanaAddress(value: string): boolean {
  return BASE58.test(value);
}

export function shortAddress(address: string, head = 4, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Hosts the icon proxy may fetch from directly when the image service is unavailable. */
export const DEFAULT_ICON_HOSTS = [
  "raw.githubusercontent.com",
  "arweave.net",
  "www.arweave.net",
  "gateway.irys.xyz",
  "static.jup.ag",
  "img-v1.raydium.io",
  "img.fotofolio.xyz",
  "metadata.jito.network",
  "storage.googleapis.com",
  "assets.coingecko.com",
  "coin-images.coingecko.com",
  "shdw-drive.genesysgo.net",
];

export function isAllowedIconUrl(raw: unknown, hosts: readonly string[] = DEFAULT_ICON_HOSTS): URL | null {
  if (typeof raw !== "string" || raw.length > 600) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const allowed = hosts.some((h) => host === h || (h.startsWith(".") ? host.endsWith(h) : host.endsWith(`.${h}`)));
  return allowed ? url : null;
}

/** Where an ipfs:// link is pointed. Public gateways like this one rate-limit servers, so see ipfsGatewayUrl. */
const IPFS_IO = "https://ipfs.io/ipfs/";
/** CIDv0 (base58, "Qm…") or CIDv1 in base32 ("baf…"), the forms gateways use. */
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

function contentPath(cid: string, path: string): string {
  return `${cid}${path && path !== "/" ? path : ""}`;
}

/** The IPFS content an https gateway URL points at, if it is one (subdomain or path form). */
export function ipfsContent(url: URL): { cid: string; path: string } | null {
  const subdomain = url.hostname.toLowerCase().match(/^([a-z0-9]+)\.ipfs\.[a-z0-9.-]+$/);
  if (subdomain && CID.test(subdomain[1]!)) return { cid: subdomain[1]!, path: url.pathname };
  const pathGateway = url.pathname.match(/^\/ipfs\/([A-Za-z0-9]+)(\/.*)?$/);
  if (pathGateway && CID.test(pathGateway[1]!)) return { cid: pathGateway[1]!, path: pathGateway[2] ?? "" };
  return null;
}

/**
 * The same IPFS content on the deployment's own gateway. `template` is either
 * a prefix the content id is appended to ("https://gw.example/ipfs/") or a URL
 * with "{cid}" where the id goes, for gateways that take a token in the query.
 */
export function ipfsGatewayUrl(template: string, content: { cid: string; path: string }): URL | null {
  const id = contentPath(content.cid, content.path);
  const text = template.includes("{cid}") ? template.replace("{cid}", id) : `${template}${id}`;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/**
 * The icon URL a token's metadata names, made safe to request from the
 * server: https only, no credentials or ports, a public host name (no IP
 * literals or local names). An ipfs:// link becomes an https gateway URL.
 */
export function normalizeIconUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > 600) return null;
  if (text.toLowerCase().startsWith("ipfs://")) {
    const rest = text.slice(7).replace(/^ipfs\//i, "");
    const slash = rest.indexOf("/");
    const cid = slash < 0 ? rest : rest.slice(0, slash);
    return CID.test(cid) ? new URL(`${IPFS_IO}${contentPath(cid, slash < 0 ? "" : rest.slice(slash))}`) : null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal|lan|home)$/.test(host)) return null;
  return url;
}

/**
 * The icon URL spelled exactly as the metadata has it when that is already
 * https (image caches key on that spelling), otherwise its safe https form.
 */
export function iconSpelling(raw: unknown, url: URL): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return /^https:\/\//i.test(text) ? text : url.toString();
}

/** Same-origin proxy URL for a token icon, or null when the metadata names none usable. */
export function proxiedIconUrl(raw: unknown): string | null {
  const url = normalizeIconUrl(raw);
  return url ? `/api/token-icon?u=${encodeURIComponent(iconSpelling(raw, url))}` : null;
}
