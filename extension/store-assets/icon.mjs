// The Ideation mark: a light bulb whose filament is a sound wave ("speak an
// idea"). Blue for the Full edition, orange for Lite. The same SVG is used for
// the extension icon (16/48/128) and the store promo tiles.

export const BRAND = {
  full: { color: "#2563eb", name: "Ideation" },
  lite: { color: "#f97316", name: "Ideation Lite" },
};

/** Full icon: rounded square in the brand color with the white bulb mark. */
export function iconSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect width="128" height="128" rx="28" fill="${color}"/>
${markSvg(color)}
</svg>`;
}

/**
 * Just the mark (white bulb with the wave cut out in `color`), for placing on
 * other backgrounds. Coordinates are in the same 128x128 space.
 */
export function markSvg(color) {
  return `<path d="M64 20c-19.9 0-34 14.2-34 32 0 10 4.6 17.2 9.8 23.5 3.5 4.2 6 8.1 7.2 12.5h34c1.2-4.4 3.7-8.3 7.2-12.5C93.4 69.2 98 62 98 52c0-17.8-14.1-32-34-32z" fill="#fff"/>
<rect x="50" y="94" width="28" height="8" rx="4" fill="#fff"/>
<rect x="54" y="106" width="20" height="8" rx="4" fill="#fff"/>
<g fill="${color}">
<rect x="43" y="52" width="6" height="12" rx="3"/>
<rect x="52" y="44" width="6" height="28" rx="3"/>
<rect x="61" y="38" width="6" height="40" rx="3"/>
<rect x="70" y="44" width="6" height="28" rx="3"/>
<rect x="79" y="52" width="6" height="12" rx="3"/>
</g>`;
}

/** Data URI for inlining the icon in HTML. */
export function iconDataUri(color) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg(color))}`;
}
