import { expect, test } from "vitest";
import { tokens } from "./index";

test("exports placeholder tokens as plain strings", () => {
  expect(tokens.color.accent).toMatch(/^#[0-9a-f]{6}$/i);
  expect(tokens.font.body).toContain("sans-serif");
  expect(Object.values(tokens.space).every((v) => typeof v === "string")).toBe(true);
});
