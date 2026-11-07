// Turns tokens.json into tokens.css. Used by scripts/build-tokens.ts (which writes the file) and by
// tokens.css.test.ts (which checks the committed file matches a fresh run). Pure: no file access.

import type { TokenFile, TypeStyle } from "./types.ts";

const HEADER = `/*
 * Generated from packages/ui/src/tokens/tokens.json by packages/ui/scripts/build-tokens.ts.
 * Do not edit by hand: change tokens.json (see src/tokens/overrides.ts), then run
 * \`pnpm --filter @vbt/ui tokens\`.
 */`;

/** Converts a px length to rem against the 16px browser default, so type follows the user's font size. */
export function pxToRem(value: string): string {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (!match) throw new Error(`Expected a px value, got "${value}"`);
  const rem = Number(match[1]) / 16;
  return `${Number(rem.toFixed(4))}rem`;
}

/**
 * A family stack whose first family can be supplied by a font loader (next/font) through
 * `--font-<kebab family name>`, falling back to the stack from tokens.json.
 * "\"Instrument Sans\", Arial" -> "var(--font-instrument-sans, \"Instrument Sans\"), Arial"
 */
export function loaderFamilyStack(stack: string): string {
  const [first, ...rest] = stack.split(",").map((part) => part.trim());
  if (!first) throw new Error("Empty font stack");
  const slug = first.replace(/["']/g, "").trim().toLowerCase().replace(/\s+/g, "-");
  return [`var(--font-${slug}, ${first})`, ...rest].join(", ");
}

function stripPrefix(name: string, prefix: string): string {
  if (!name.startsWith(prefix)) throw new Error(`Token "${name}" should start with "${prefix}"`);
  return name.slice(prefix.length);
}

function typeLines(style: TypeStyle): string[] {
  const base = `--text-${style.name}`;
  const lines = [
    `${base}: ${pxToRem(style.fontSize)};`,
    `${base}--line-height: ${pxToRem(style.lineHeight)};`,
    `${base}--font-weight: ${style.fontWeight};`,
  ];
  if (style.letterSpacing) lines.push(`${base}--letter-spacing: ${style.letterSpacing};`);
  return lines;
}

/**
 * Tailwind theme variable for a motion token: duration-* feeds the `duration-*` utilities
 * (namespace --transition-duration), ease-* feeds `ease-*` (namespace --ease).
 */
export function motionThemeVariable(name: string): string {
  if (name.startsWith("duration-")) return `--transition-${name}`;
  if (name.startsWith("ease-")) return `--${name}`;
  throw new Error(`Motion token "${name}" should start with "duration-" or "ease-"`);
}

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;
}

export function generateTokensCss(tokens: TokenFile): string {
  const colors = tokens.color.tokens;
  const shadows = tokens.shadow.tokens;
  const motion = tokens.motion.tokens;

  const root = block(":root", [
    "color-scheme: light;",
    ...colors.map((c) => `--vbt-${c.name}: ${c.value.light};`),
    ...shadows.map((s) => `--vbt-${s.name}: ${s.value.light};`),
    ...tokens.radius.tokens.map((r) => `--vbt-${r.name}: ${r.value};`),
    ...tokens.spacing.tokens.map((s) => `--vbt-${s.name}: ${s.value};`),
    ...motion.map((m) => `--vbt-${m.name}: ${m.value};`),
    `--vbt-font-sans: ${loaderFamilyStack(tokens.type.families.sans)};`,
    `--vbt-font-mono: ${loaderFamilyStack(tokens.type.families.mono)};`,
  ]);

  const dark = block('[data-theme="dark"]', [
    "color-scheme: dark;",
    ...colors.map((c) => `--vbt-${c.name}: ${c.value.dark};`),
    ...shadows.map((s) => `--vbt-${s.name}: ${s.value.dark};`),
  ]);

  const theme = block("@theme inline", [
    // Drop Tailwind's default palette so only token colors exist as utilities.
    "--color-*: initial;",
    ...colors.map((c) => `--color-${c.name}: var(--vbt-${c.name});`),
    ...tokens.radius.tokens.map((r) => `--radius-${stripPrefix(r.name, "radius-")}: var(--vbt-${r.name});`),
    ...shadows.map((s) => `--shadow-${stripPrefix(s.name, "shadow-")}: var(--vbt-${s.name});`),
    ...motion.map((m) => `${motionThemeVariable(m.name)}: var(--vbt-${m.name});`),
    "--font-sans: var(--vbt-font-sans);",
    "--font-mono: var(--vbt-font-mono);",
    ...tokens.type.groups.flatMap((group) => group.styles.flatMap(typeLines)),
  ]);

  return `${HEADER}\n\n${root}\n\n${dark}\n\n${theme}\n`;
}
