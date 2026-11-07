// Shape of docs/design-system/design-system/tokens.json (copied to ./tokens.json).

export type ThemeId = "light" | "dark";

export interface ColorToken {
  name: string;
  value: Record<ThemeId, string>;
  usage: string;
}

export interface TypeStyle {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
  sample: string;
  usage: string;
}

export interface TypeGroup {
  name: string;
  family: "sans" | "mono";
  styles: TypeStyle[];
}

export interface SimpleToken {
  name: string;
  value: string;
  usage: string;
}

export interface ShadowToken {
  name: string;
  value: Record<ThemeId, string>;
  usage: string;
}

export interface ContrastPair {
  fg: string;
  bg: string;
  /** WCAG minimum: 4.5 for text, 3 for non-text marks. */
  min: number;
  /** Themes to check; every theme when absent (as in docs/design-system/scripts/check-contrast.mjs). */
  themes?: ThemeId[];
}

export interface TokenFile {
  name: string;
  version: number;
  color: { themes: { id: ThemeId; name: string }[]; tokens: ColorToken[] };
  type: { fonts: unknown[]; families: Record<"sans" | "mono", string>; groups: TypeGroup[] };
  spacing: { tokens: SimpleToken[] };
  radius: { tokens: SimpleToken[] };
  shadow: { tokens: ShadowToken[] };
  contrast: { standard: string; check: string; pairs: ContrastPair[] };
  motion: { tokens: SimpleToken[] };
}
