// WCAG 2.2 contrast ratio (SC 1.4.3 and 1.4.11).
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

/** Minimum ratios: normal text 4.5:1; large text, icons, control borders and focus rings 3:1. */
export const MIN_TEXT = 4.5;
export const MIN_NON_TEXT = 3;

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Not a hex color: "${hex}"`);
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join("");
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
