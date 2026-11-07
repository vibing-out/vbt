// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { overrides, type TokenOverride } from "./overrides";

const docsPath = new URL("../../../../docs/design-system/design-system/tokens.json", import.meta.url);
const copyPath = new URL("./tokens.json", import.meta.url);

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"));
}

function setPointer(root: unknown, pointer: string, value: unknown): void {
  const parts = pointer
    .split("/")
    .slice(1)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  const last = parts.pop();
  if (last === undefined) throw new Error(`Bad pointer "${pointer}"`);
  let node = root as Record<string, unknown>;
  for (const part of parts) {
    if (!(part in node)) throw new Error(`Pointer "${pointer}" not found at "${part}"`);
    node = node[part] as Record<string, unknown>;
  }
  if (!(last in node)) throw new Error(`Pointer "${pointer}" not found at "${last}"`);
  node[last] = value;
}

export function applyOverrides(source: unknown, list: readonly TokenOverride[]): unknown {
  const copy = structuredClone(source);
  for (const o of list) setPointer(copy, o.pointer, o.value);
  return copy;
}

describe("tokens.json copy", () => {
  test("equals the approved docs tokens, apart from the listed overrides", () => {
    expect(readJson(copyPath)).toEqual(applyOverrides(readJson(docsPath), overrides));
  });

  test("every override has a reason and a context-log decision", () => {
    for (const o of overrides) {
      expect(o.pointer).toMatch(/^\//);
      expect(o.reason.trim()).not.toBe("");
      expect(o.decision.trim()).not.toBe("");
    }
  });

  test("applyOverrides changes only the pointed-at value", () => {
    const source = { color: { tokens: [{ name: "ink", value: { light: "#000000" } }] } };
    const result = applyOverrides(source, [
      { pointer: "/color/tokens/0/value/light", value: "#111111", reason: "r", decision: "d" },
    ]);
    expect(result).toEqual({ color: { tokens: [{ name: "ink", value: { light: "#111111" } }] } });
    expect(source.color.tokens[0]?.value.light).toBe("#000000");
    expect(() => applyOverrides(source, [{ pointer: "/color/nope", value: 1, reason: "r", decision: "d" }])).toThrow();
  });
});
