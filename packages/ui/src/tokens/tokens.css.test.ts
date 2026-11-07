// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { generateTokensCss, loaderFamilyStack, motionThemeVariable, pxToRem } from "./generate";
import { COLOR_NAMES, tokens } from "./index";

const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

function blockBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("tokens.css", () => {
  test("matches a fresh run of the generator (run `pnpm --filter @vbt/ui tokens` if not)", () => {
    expect(css).toBe(generateTokensCss(tokens));
  });

  test("COLOR_NAMES lists exactly the tokens.json colors", () => {
    expect([...COLOR_NAMES]).toEqual(tokens.color.tokens.map((t) => t.name));
  });

  test("defines every color in light (:root) and dark, and maps it for Tailwind", () => {
    const root = blockBody(":root");
    const dark = blockBody('[data-theme="dark"]');
    const theme = blockBody("@theme inline");
    for (const c of tokens.color.tokens) {
      expect(root).toContain(`--vbt-${c.name}: ${c.value.light};`);
      expect(dark).toContain(`--vbt-${c.name}: ${c.value.dark};`);
      expect(theme).toContain(`--color-${c.name}: var(--vbt-${c.name});`);
    }
    // Tailwind's default palette is dropped so only token colors exist.
    expect(theme).toContain("--color-*: initial;");
  });

  test("defines every radius, shadow, font and type style", () => {
    const root = blockBody(":root");
    const dark = blockBody('[data-theme="dark"]');
    const theme = blockBody("@theme inline");
    for (const r of tokens.radius.tokens) {
      expect(root).toContain(`--vbt-${r.name}: ${r.value};`);
      expect(theme).toContain(`--${r.name}: var(--vbt-${r.name});`);
    }
    for (const s of tokens.shadow.tokens) {
      expect(root).toContain(`--vbt-${s.name}: ${s.value.light};`);
      expect(dark).toContain(`--vbt-${s.name}: ${s.value.dark};`);
      expect(theme).toContain(`--${s.name}: var(--vbt-${s.name});`);
    }
    expect(theme).toContain("--font-sans: var(--vbt-font-sans);");
    expect(theme).toContain("--font-mono: var(--vbt-font-mono);");
    expect(root).toContain('--vbt-font-sans: var(--font-instrument-sans, "Instrument Sans"), "Helvetica Neue"');
    for (const style of tokens.type.groups.flatMap((g) => g.styles)) {
      expect(theme).toContain(`--text-${style.name}: ${pxToRem(style.fontSize)};`);
      expect(theme).toContain(`--text-${style.name}--line-height: ${pxToRem(style.lineHeight)};`);
      expect(theme).toContain(`--text-${style.name}--font-weight: ${style.fontWeight};`);
      if (style.letterSpacing) {
        expect(theme).toContain(`--text-${style.name}--letter-spacing: ${style.letterSpacing};`);
      }
    }
  });

  test("the spacing scale is exactly Tailwind's 4px steps 1, 2, 3, 4, 6, 8, 12", () => {
    for (const s of tokens.spacing.tokens) {
      const step = Number(s.name.replace("space-", ""));
      expect(s.value).toBe(`${step * 4}px`);
    }
    expect(tokens.spacing.tokens.map((s) => s.name)).toEqual([1, 2, 3, 4, 6, 8, 12].map((n) => `space-${n}`));
  });

  test("defines every motion token and maps it to Tailwind's duration-* and ease-* utilities", () => {
    const root = blockBody(":root");
    const theme = blockBody("@theme inline");
    expect(tokens.motion.tokens.map((m) => m.name)).toEqual(["duration-fast", "duration-base", "duration-slow", "ease-out"]);
    for (const m of tokens.motion.tokens) expect(root).toContain(`--vbt-${m.name}: ${m.value};`);
    expect(theme).toContain("--transition-duration-base: var(--vbt-duration-base);");
    expect(theme).toContain("--ease-out: var(--vbt-ease-out);");
  });

  test("focus-inverse is a color in both themes", () => {
    expect(blockBody(":root")).toContain("--vbt-focus-inverse: #8FB0FF;");
    expect(blockBody("@theme inline")).toContain("--color-focus-inverse: var(--vbt-focus-inverse);");
  });

  test('[data-theme="light"] restates every light color, for light islands like the QR tile', () => {
    const light = blockBody('[data-theme="light"]');
    expect(light).toContain("color-scheme: light;");
    for (const c of tokens.color.tokens) expect(light).toContain(`--vbt-${c.name}: ${c.value.light};`);
    // It comes before the dark block, so a nested data-theme="light" wins by being closer, not by order.
    expect(css.indexOf('[data-theme="light"] {')).toBeLessThan(css.indexOf('[data-theme="dark"] {'));
  });

  test("the status headline is the 32px display token", () => {
    expect(css).toContain("--text-display: 2rem;");
  });
});

describe("generator helpers", () => {
  test("pxToRem", () => {
    expect(pxToRem("32px")).toBe("2rem");
    expect(pxToRem("13px")).toBe("0.8125rem");
    expect(() => pxToRem("2rem")).toThrow();
  });

  test("motionThemeVariable", () => {
    expect(motionThemeVariable("duration-fast")).toBe("--transition-duration-fast");
    expect(motionThemeVariable("ease-out")).toBe("--ease-out");
    expect(() => motionThemeVariable("bounce")).toThrow();
  });

  test("loaderFamilyStack puts the loader variable first", () => {
    expect(loaderFamilyStack('"JetBrains Mono", monospace')).toBe(
      'var(--font-jetbrains-mono, "JetBrains Mono"), monospace',
    );
  });
});
