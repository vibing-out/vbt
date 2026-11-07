// @vitest-environment node
import { describe, expect, test } from "vitest";
import { colorValue, COLOR_NAMES, type ColorName, type ThemeId, tokens } from "../tokens";
import { contrastRatio, hexToRgb, MIN_NON_TEXT, MIN_TEXT } from "./contrast";
import { colorPairs, decorativePairs } from "./pairs";

describe("contrastRatio (WCAG 2.2)", () => {
  test("known values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777", "#FFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
    // Symmetric.
    expect(contrastRatio("#14213D", "#F6F4EE")).toBeCloseTo(contrastRatio("#F6F4EE", "#14213D"), 10);
  });

  test("hexToRgb", () => {
    expect(hexToRgb("#E07A2E")).toEqual([224, 122, 46]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(() => hexToRgb("rgb(0,0,0)")).toThrow();
  });
});

const THEMES: ThemeId[] = ["light", "dark"];

describe("every color pair the components use meets WCAG AA in both themes", () => {
  test.each(colorPairs.flatMap((p) => THEMES.map((theme) => ({ ...p, theme }))))(
    "$fg on $bg ($theme) >= $min ($where)",
    ({ fg, bg, min, theme }) => {
      expect(contrastRatio(colorValue(fg, theme), colorValue(bg, theme))).toBeGreaterThanOrEqual(min);
    },
  );
});

describe("every pair in tokens.json contrast.pairs (the approved pairs plus logged overrides) passes", () => {
  const themes = (t?: ThemeId[]) => t ?? tokens.color.themes.map((x) => x.id);
  test.each(tokens.contrast.pairs.flatMap((p) => themes(p.themes).map((theme) => ({ ...p, theme }))))(
    "$fg on $bg ($theme) >= $min",
    ({ fg, bg, min, theme }) => {
      expect(COLOR_NAMES).toContain(fg);
      expect(COLOR_NAMES).toContain(bg);
      expect(contrastRatio(colorValue(fg as ColorName, theme), colorValue(bg as ColorName, theme))).toBeGreaterThanOrEqual(
        min,
      );
    },
  );
});

describe("pairs.ts and tokens.json contrast.pairs agree", () => {
  test.each(colorPairs.map((p) => ({ ...p })))("$fg on $bg (min $min) is in contrast.pairs", ({ fg, bg, min }) => {
    const listed = tokens.contrast.pairs.find((p) => p.fg === fg && p.bg === bg);
    expect(listed, `${fg} on ${bg} missing from tokens.json contrast.pairs`).toBeDefined();
    // The approved pair is held at least as high as the component needs.
    expect(listed?.min ?? 0).toBeGreaterThanOrEqual(min);
    // Checked in every theme, as the components render in both.
    expect(listed?.themes).toBeUndefined();
  });
});

describe("the pair table covers every pair the component READMEs list", () => {
  const has = (fg: string, bg: string, min: number) =>
    colorPairs.some((p) => p.fg === fg && p.bg === bg && p.min >= min);

  test.each([
    ...["surface", "surface-raised", "surface-sunk"].flatMap((bg) => [
      ["ink", bg, MIN_TEXT],
      ["ink-muted", bg, MIN_TEXT],
    ]),
    // StatusBadge: every text-on-fill pair, and the dots.
    ["ink", "stage-done", MIN_TEXT],
    ["ink", "accent-tint", MIN_TEXT],
    ["accent-mark", "accent-tint", MIN_NON_TEXT],
    ...["challenged", "discarded", "spoiled"].flatMap((s) => [
      [`status-${s}`, `status-${s}-bg`, MIN_TEXT],
      [`status-${s}`, "surface", MIN_TEXT],
      [`status-${s}`, "surface-raised", MIN_TEXT],
    ]),
    // StageTimeline: ink and accent-text on surface-raised; on-inverse, on-inverse-muted and
    // brand-orange on surface-inverse; accent-mark and line-strong marks at 3:1.
    ["accent-text", "surface-raised", MIN_TEXT],
    ["on-inverse", "surface-inverse", MIN_TEXT],
    ["on-inverse-muted", "surface-inverse", MIN_TEXT],
    ["brand-orange", "surface-inverse", MIN_TEXT],
    ["accent-mark", "surface-raised", MIN_NON_TEXT],
    ["line-strong", "surface-raised", MIN_NON_TEXT],
    ["surface-raised", "ink", MIN_NON_TEXT],
    // Buttons, inputs and focus.
    ["on-accent", "brand-orange", MIN_TEXT],
    ...["surface", "surface-raised", "surface-sunk"].flatMap((bg) => [
      ["line-strong", bg, MIN_NON_TEXT],
      ["focus", bg, MIN_NON_TEXT],
    ]),
    ["focus-inverse", "surface-inverse", MIN_NON_TEXT],
    ["on-inverse", "surface-inverse", MIN_NON_TEXT],
  ] as [string, string, number][])("%s on %s >= %s", (fg, bg, min) => {
    expect(has(fg, bg, min)).toBe(true);
  });

  test("every text pair is held to 4.5:1", () => {
    for (const p of colorPairs) expect([MIN_TEXT, MIN_NON_TEXT]).toContain(p.min);
    expect(colorPairs.every((p) => (COLOR_NAMES as readonly string[]).includes(p.fg))).toBe(true);
  });

  test("brand-orange is never used on accent-tint (2.54:1 in light); accent-mark is the mark there", () => {
    expect(colorPairs.some((p) => p.fg === "brand-orange" && p.bg === "accent-tint")).toBe(false);
    expect(contrastRatio(colorValue("brand-orange", "light"), colorValue("accent-tint", "light"))).toBeLessThan(MIN_NON_TEXT);
  });

  test("decorative pairs carry a reason and are not also listed as meaningful", () => {
    for (const d of decorativePairs) {
      expect(d.why.trim()).not.toBe("");
      expect(colorPairs.some((p) => p.fg === d.fg && p.bg === d.bg)).toBe(false);
    }
  });
});

/** fg at alpha over bg, as the browser composites it. */
function blend(fg: string, bg: string, alpha: number): string {
  const [f, b] = [hexToRgb(fg), hexToRgb(bg)];
  return `#${f.map((c, i) => Math.round(alpha * c + (1 - alpha) * (b[i] ?? 0)).toString(16).padStart(2, "0")).join("")}`;
}

describe("marks drawn against a translucent color", () => {
  test.each(THEMES)("the hero current dot (brand-orange) against its 30%% halo >= 3:1 (%s)", (theme) => {
    const inverse = colorValue("surface-inverse", theme);
    const halo = blend(colorValue("brand-orange", theme), inverse, 0.3);
    expect(contrastRatio(colorValue("brand-orange", theme), halo)).toBeGreaterThanOrEqual(MIN_NON_TEXT);
  });

  test.each(THEMES)("status colors fail on surface-inverse in light, so the hero uses on-inverse dots (%s)", (theme) => {
    const inverse = colorValue("surface-inverse", theme);
    const worst = Math.min(
      ...(["status-challenged", "status-discarded", "status-spoiled"] as const).map((s) =>
        contrastRatio(colorValue(s, theme), inverse),
      ),
    );
    if (theme === "light") expect(worst).toBeLessThan(MIN_NON_TEXT);
    expect(colorPairs.some((p) => p.fg.startsWith("status-") && p.bg === "surface-inverse")).toBe(false);
  });
});
