// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const print = readFileSync(new URL("./print.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

test("globals.css imports tailwind, the tokens and the print rules", () => {
  expect(globals).toContain('@import "tailwindcss";');
  expect(globals).toContain('@import "./tokens.css";');
  expect(globals).toContain('@import "./print.css";');
});

test("print.css has one @media print block with the required rules", () => {
  expect(print.match(/@media print/g)).toHaveLength(1);
  const block = print.slice(print.indexOf("@media print"));
  expect(block).toMatch(/\[data-print="hide"\][\s\S]*display: none/);
  expect(block).toMatch(/\.vbt-print-only \{\s*display: revert/);
  expect(block).toContain("break-inside: avoid;");
  expect(block).toMatch(/\.vbt-badge \{\s*outline: 1px solid currentColor/);
  expect(block).toContain("box-shadow: none");
  // The receipt slip prints black only, with no gray fills (Receipt README, Paper: the slip).
  const slip = block.match(/\.vbt-slip,\s*\.vbt-slip \* \{([^}]*)\}/);
  expect(slip, "a .vbt-slip, .vbt-slip * rule").not.toBeNull();
  const decls = slip![1]!;
  expect(decls).toMatch(/(^|;)\s*color: black !important;/);
  expect(decls).toMatch(/border-color: black !important;/);
  expect(decls).toMatch(/background: transparent !important;/);
  expect(decls).toMatch(/box-shadow: none !important;/);
  // On screen, print-only content stays hidden.
  expect(print.slice(0, print.indexOf("@media print"))).toMatch(/\.vbt-print-only \{\s*display: none;/);
});
