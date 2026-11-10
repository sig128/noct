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

/** Hosts whose images the server-side icon proxy may fetch. */
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

/** Same-origin proxy URL for a provider icon, or null when the host is not allowlisted. */
export function proxiedIconUrl(raw: unknown, hosts?: readonly string[]): string | null {
  const url = isAllowedIconUrl(raw, hosts);
  return url ? `/api/token-icon?u=${encodeURIComponent(url.toString())}` : null;
}
