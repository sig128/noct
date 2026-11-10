/**
 * NOCT's mark: a first-quarter moon, sunlit from the right. Drawn in SVG so it
 * stays sharp from the 16 px favicon up to the landing page: a shaded sunlit
 * half with a rugged terminator, the eastern maria (Serenitatis, Tranquillitatis,
 * Crisium, Fecunditatis, Nectaris), craters with long shadows near the
 * terminator, and a faint earthlit night side so the whole disc reads.
 *
 * `src/app/icon.svg` is this art with the prefix "m"; tests/moon-art.test.ts
 * keeps the two identical.
 */

type Crater = readonly [cx: number, cy: number, r: number];

const CRATERS: readonly Crater[] = [
  [33.6, 36.4, 1.45], [33.8, 40.7, 1.2], [34.0, 44.5, 1.05], [35.4, 48.7, 1.75], [38.9, 52.5, 1.35], [36.6, 56.1, 1.1],
  [40.0, 43.0, 1.5], [41.4, 46.1, 1.05], [46.5, 51.7, 1.4], [52.4, 48.2, 0.95], [44.0, 55.4, 1.0], [33.4, 31.0, 0.9],
  [36.6, 12.6, 0.95], [41.5, 10.6, 0.85], [47.4, 14.6, 1.0], [56.6, 30.6, 0.8], [55.2, 42.0, 0.9],
];

/** Lit from the right: the inner wall facing the sun is bright, the far wall in shadow. */
function crater([cx, cy, r]: Crater): string {
  const top = `${cx} ${(cy - r).toFixed(2)}`;
  const bot = `${cx} ${(cy + r).toFixed(2)}`;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#5f5a50" fill-opacity="0.16"/>` +
    `<path d="M${top}A${r} ${r} 0 0 1 ${bot}A${(r * 0.45).toFixed(2)} ${r} 0 0 0 ${top}Z" fill="#37332c" fill-opacity="0.42"/>` +
    `<path d="M${top}A${r} ${r} 0 0 0 ${bot}" fill="none" stroke="#fffdf6" stroke-opacity="0.32" stroke-width="${Math.max(0.3, r * 0.2).toFixed(2)}"/>`
  );
}

/** The art without the outer <svg> element, for a 64 × 64 viewBox. `p` prefixes every id. */
export function moonArt(p: string): string {
  return [
    "<defs>",
    `<clipPath id="${p}-disc"><circle cx="32" cy="32" r="28"/></clipPath>`,
    `<linearGradient id="${p}-term" x1="31" x2="34" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>`,
    `<filter id="${p}-rough" filterUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><feTurbulence type="fractalNoise" baseFrequency="0.22 0.55" numOctaves="2" seed="21" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="R"/></filter>`,
    `<mask id="${p}-lit" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect x="-4" width="72" height="64" fill="url(#${p}-term)" filter="url(#${p}-rough)"/></mask>`,
    `<linearGradient id="${p}-haloside" x1="28" x2="44" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>`,
    `<mask id="${p}-halomask" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="url(#${p}-haloside)"/></mask>`,
    `<linearGradient id="${p}-sun" x1="32" x2="60" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8d887d"/><stop offset="0.12" stop-color="#cbc6b8"/><stop offset="0.5" stop-color="#e7e3d8"/><stop offset="1" stop-color="#f6f3eb"/></linearGradient>`,
    `<radialGradient id="${p}-sphere" cx="44" cy="32" r="30" gradientUnits="userSpaceOnUse"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/></radialGradient>`,
    `<radialGradient id="${p}-earth" cx="24" cy="30" r="30" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#171c1f"/><stop offset="1" stop-color="#0d1012"/></radialGradient>`,
    `<radialGradient id="${p}-halo" cx="32" cy="32" r="32" gradientUnits="userSpaceOnUse"><stop offset="0.855" stop-color="#f2eee2" stop-opacity="0"/><stop offset="0.878" stop-color="#f2eee2" stop-opacity="0.16"/><stop offset="0.99" stop-color="#f2eee2" stop-opacity="0"/></radialGradient>`,
    `<filter id="${p}-grain" filterUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="11"/><feColorMatrix values="0 0 0 0 0.22  0 0 0 0 0.2  0 0 0 0 0.17  0 0 0 0.9 -0.34"/></filter>`,
    `<filter id="${p}-albedo" filterUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="3" seed="8"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.28  0 0 0 0 0.25  0 0 0 1.1 -0.42"/></filter>`,
    `<filter id="${p}-mare" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.38" numOctaves="3" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.6" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="0.7"/></filter>`,
    "</defs>",
    `<rect width="64" height="64" fill="url(#${p}-halo)" mask="url(#${p}-halomask)"/>`,
    `<circle cx="32" cy="32" r="28" fill="url(#${p}-earth)"/>`,
    `<g clip-path="url(#${p}-disc)" mask="url(#${p}-lit)">`,
    `<rect width="64" height="64" fill="url(#${p}-sun)"/>`,
    `<rect width="64" height="64" filter="url(#${p}-albedo)" opacity="0.55"/>`,
    `<g fill="#7d786d" fill-opacity="0.7" filter="url(#${p}-mare)">`,
    `<ellipse cx="38.4" cy="20.4" rx="5" ry="4.5"/>`,
    `<path d="M38.2 27.2c2.8-2.6 7.6-3.4 10.6-1.6 2.6 1.6 2.4 5 .4 7.2-2.2 2.5-6.6 3.4-9.4 2-2.6-1.3-4-5.4-1.6-7.6z"/>`,
    `<ellipse cx="53.4" cy="22.2" rx="3.1" ry="2.5"/>`,
    `<ellipse cx="50.8" cy="37.6" rx="3.3" ry="5.1" transform="rotate(16 50.8 37.6)"/>`,
    `<ellipse cx="43.4" cy="41.2" rx="2.7" ry="2.4"/>`,
    `<ellipse cx="34.6" cy="25.6" rx="2.3" ry="1.8"/>`,
    `<path d="M33 14.6c2.6-1 6.2-1.2 8.4-.6l-.2 1.4c-2.6-.2-5.6.2-8 1z"/>`,
    `<path d="M41.6 23.6c1.2.6 1.8 1.8 1.6 3l-2.4.4c-.4-1.2-.2-2.4.8-3.4z"/>`,
    `<path d="M47.2 33.4c1 .8 1.6 2 1.6 3.2l-2.2.2c-.4-1.2-.2-2.4.6-3.4z"/>`,
    `<path d="M42.6 36.6c.6 1 .8 2.2.6 3.2l-2 .2c-.2-1.2 0-2.4 1.4-3.4z"/>`,
    "</g>",
    `<g fill="#6f6a60" fill-opacity="0.4" filter="url(#${p}-mare)">`,
    `<ellipse cx="38.8" cy="20.8" rx="3.2" ry="2.8"/>`,
    `<ellipse cx="44.6" cy="30.2" rx="4" ry="2.8" transform="rotate(-14 44.6 30.2)"/>`,
    `<ellipse cx="53.4" cy="22.3" rx="2" ry="1.5"/>`,
    `<ellipse cx="50.9" cy="37.9" rx="2" ry="3.2" transform="rotate(16 50.9 37.9)"/>`,
    "</g>",
    `<rect width="64" height="64" filter="url(#${p}-grain)"/>`,
    CRATERS.map(crater).join(""),
    `<rect width="64" height="64" fill="url(#${p}-sphere)"/>`,
    "</g>",
    `<circle cx="32" cy="32" r="27.7" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="0.6"/>`,
  ].join("\n");
}

/** A standalone SVG document (the favicon). */
export function moonSvg(p = "m"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n${moonArt(p)}\n</svg>\n`;
}
