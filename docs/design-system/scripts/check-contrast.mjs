#!/usr/bin/env node
// Checks every color pair listed in design-system/tokens.json under
// "contrast" against its WCAG 2.2 minimum, in both themes.
// Usage: node scripts/check-contrast.mjs [path/to/tokens.json]
// Exits 1 if any pair fails or names a token that does not exist.

import { readFileSync } from "node:fs";

const file = process.argv[2] ?? new URL("../design-system/tokens.json", import.meta.url);
const tokens = JSON.parse(readFileSync(file, "utf8"));

const colors = new Map(tokens.color.tokens.map((t) => [t.name, t.value]));
const themes = tokens.color.themes.map((t) => t.id);

function channel(hex2) {
  const c = parseInt(hex2, 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(h.slice(i, i + 2)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;
const rows = [];

for (const pair of tokens.contrast.pairs) {
  for (const name of [pair.fg, pair.bg]) {
    if (!colors.has(name)) {
      console.error(`Unknown token "${name}" in pair ${pair.fg} on ${pair.bg}`);
      failures++;
    }
  }
  if (!colors.has(pair.fg) || !colors.has(pair.bg)) continue;
  const themesToCheck = pair.themes ?? themes;
  for (const theme of themesToCheck) {
    const r = ratio(colors.get(pair.fg)[theme], colors.get(pair.bg)[theme]);
    const pass = r >= pair.min;
    if (!pass) failures++;
    rows.push({ pass, theme, fg: pair.fg, bg: pair.bg, ratio: r, min: pair.min });
  }
}

for (const row of rows) {
  const mark = row.pass ? "pass" : "FAIL";
  console.log(
    `${mark}  ${row.theme.padEnd(5)}  ${row.ratio.toFixed(2).padStart(5)}:1 (min ${row.min})  ${row.fg} on ${row.bg}`,
  );
}

console.log(`\n${rows.length} checks, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
