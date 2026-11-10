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
  "ipfs.io",
  "gateway.irys.xyz",
  "static.jup.ag",
  "img-v1.raydium.io",
  "img.fotofolio.xyz",
  "metadata.jito.network",
  "storage.googleapis.com",
  "assets.coingecko.com",
  "coin-images.coingecko.com",
  "shdw-drive.genesysgo.net",
  "bafkreih.ipfs.nftstorage.link",
  "cf-ipfs.com",
  "ipfs.dweb.link",
  "nftstorage.link",
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

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
/** CIDv0 (base58, "Qm…") or CIDv1 in base32 ("baf…"), the forms gateways use. */
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

function ipfsUrl(cid: string, path: string): URL {
  return new URL(`${IPFS_GATEWAY}${cid}${path && path !== "/" ? path : ""}`);
}

/**
 * The icon URL a token's metadata names, made safe to request from the
 * server: https only, no credentials or ports, a public host name (no IP
 * literals or local names). IPFS content is moved onto one public gateway,
 * since several gateways token metadata still points at no longer serve.
 */
export function normalizeIconUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > 600) return null;
  if (text.toLowerCase().startsWith("ipfs://")) {
    const rest = text.slice(7).replace(/^ipfs\//i, "");
    const slash = rest.indexOf("/");
    const cid = slash < 0 ? rest : rest.slice(0, slash);
    return CID.test(cid) ? ipfsUrl(cid, slash < 0 ? "" : rest.slice(slash)) : null;
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
  const subdomain = host.match(/^([a-z0-9]+)\.ipfs\.[a-z0-9.-]+$/);
  if (subdomain && CID.test(subdomain[1]!)) return ipfsUrl(subdomain[1]!, url.pathname);
  const pathGateway = url.pathname.match(/^\/ipfs\/([A-Za-z0-9]+)(\/.*)?$/);
  if (pathGateway && CID.test(pathGateway[1]!)) return ipfsUrl(pathGateway[1]!, pathGateway[2] ?? "");
  return url;
}

/** Same-origin proxy URL for a token icon, or null when the metadata names none usable. */
export function proxiedIconUrl(raw: unknown): string | null {
  const url = normalizeIconUrl(raw);
  return url ? `/api/token-icon?u=${encodeURIComponent(url.toString())}` : null;
}
