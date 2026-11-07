import tokensJson from "./tokens.json";
import type { ThemeId, TokenFile } from "./types";

export type { ColorToken, ThemeId, TokenFile, TypeGroup, TypeStyle } from "./types";

export const tokens = tokensJson as TokenFile;

/** Every color token name, in tokens.json order. A test keeps this list in step with the JSON. */
export const COLOR_NAMES = [
  "surface",
  "surface-raised",
  "surface-sunk",
  "ink",
  "ink-muted",
  "line",
  "line-strong",
  "brand-orange",
  "accent-mark",
  "accent-text",
  "on-accent",
  "focus",
  "stage-done",
  "accent-tint",
  "surface-inverse",
  "on-inverse",
  "on-inverse-muted",
  "status-challenged",
  "status-challenged-bg",
  "status-discarded",
  "status-discarded-bg",
  "status-spoiled",
  "status-spoiled-bg",
] as const;

export type ColorName = (typeof COLOR_NAMES)[number];

export function colorValue(name: ColorName, theme: ThemeId): string {
  const token = tokens.color.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`Unknown color token "${name}"`);
  return token.value[theme];
}
