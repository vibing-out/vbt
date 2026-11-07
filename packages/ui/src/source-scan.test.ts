// @vitest-environment node
// Components may style only with tokens: no raw colors, no Tailwind palette colors, no arbitrary px
// values, no default font sizes and no spacing step outside the token scale.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const dir = new URL("./components/", import.meta.url);
const files = readdirSync(dir)
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .map((f) => ({ name: f, source: readFileSync(new URL(f, dir), "utf8") }));

const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|shadow|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/;
const ARBITRARY_PX = /\[[^\]\s]*\d+px[^\]\s]*\]/;
const DEFAULT_TEXT_SIZE = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
const SPACING =
  /(?<![\w-])-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(\d+(?:\.\d+)?)(?![\w.])/g;
const ALLOWED_STEPS = new Set(["0", "1", "2", "3", "4", "6", "8", "12"]);

function badSpacing(source: string): string[] {
  return [...source.matchAll(SPACING)].filter((m) => !ALLOWED_STEPS.has(m[1] ?? "")).map((m) => m[0]);
}

describe("component sources use tokens only", () => {
  test("there are component files to scan", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  test.each(files)("$name", ({ source }) => {
    expect(source).not.toMatch(PALETTE);
    expect(source).not.toMatch(RAW_COLOR);
    expect(source).not.toMatch(ARBITRARY_PX);
    expect(source).not.toMatch(DEFAULT_TEXT_SIZE);
    expect(badSpacing(source)).toEqual([]);
  });
});

describe("the scan rules catch violations", () => {
  test.each([
    ["bg-red-500", PALETTE],
    ["text-white", PALETTE],
    ['"#FFF"', RAW_COLOR],
    ["rgb(0 0 0)", RAW_COLOR],
    ["w-[220px]", ARBITRARY_PX],
    ["text-sm", DEFAULT_TEXT_SIZE],
  ])("%s", (snippet, rule) => {
    expect(snippet).toMatch(rule);
  });

  test("spacing", () => {
    expect(badSpacing('"p-5 md:gap-7 py-0.5 -mt-10"')).toEqual(["p-5", "gap-7", "py-0.5", "-mt-10"]);
    expect(badSpacing('"p-4 md:p-6 gap-x-2 space-y-12 px-3 size-55 min-h-11"')).toEqual([]);
  });
});
