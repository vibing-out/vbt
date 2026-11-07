// @vitest-environment node
import { describe, expect, test } from "vitest";
import { colorValue, COLOR_NAMES, type ThemeId } from "../tokens";
import { contrastRatio, hexToRgb, MIN_NON_TEXT, MIN_TEXT } from "./contrast";
import { colorPairs } from "./pairs";

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

describe("the pair table covers what the plan requires", () => {
  const has = (fg: string, bg: string, min: number) =>
    colorPairs.some((p) => p.fg === fg && p.bg === bg && p.min >= min);

  test.each([
    ...["surface", "surface-raised", "surface-sunk", "stage-done"].flatMap((bg) => [
      ["ink", bg, MIN_TEXT],
      ["ink-muted", bg, MIN_TEXT],
    ]),
    ...["surface", "surface-raised", "accent-tint"].map((bg) => ["accent-text", bg, MIN_TEXT]),
    ["on-accent", "brand-orange", MIN_TEXT],
    ["on-inverse", "surface-inverse", MIN_TEXT],
    ["on-inverse-muted", "surface-inverse", MIN_TEXT],
    ...["challenged", "discarded", "spoiled"].flatMap((s) => [
      [`status-${s}`, `status-${s}-bg`, MIN_TEXT],
      [`status-${s}`, "surface", MIN_TEXT],
    ]),
    ...["surface", "surface-raised", "surface-sunk"].flatMap((bg) => [
      ["line-strong", bg, MIN_NON_TEXT],
      ["accent-mark", bg, MIN_NON_TEXT],
      ["focus", bg, MIN_NON_TEXT],
    ]),
    ["brand-orange", "surface-inverse", MIN_NON_TEXT],
    ["on-inverse", "surface-inverse", MIN_NON_TEXT],
  ] as [string, string, number][])("%s on %s >= %s", (fg, bg, min) => {
    expect(has(fg, bg, min)).toBe(true);
  });

  test("every text pair is held to 4.5:1", () => {
    for (const p of colorPairs) expect([MIN_TEXT, MIN_NON_TEXT]).toContain(p.min);
    expect(colorPairs.every((p) => (COLOR_NAMES as readonly string[]).includes(p.fg))).toBe(true);
  });
});
