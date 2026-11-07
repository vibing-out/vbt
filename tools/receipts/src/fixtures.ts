// Test fixtures: the example input that ships with the tool, parsed.
import { readFileSync } from "node:fs";
import { parseInput, type ReceiptsInput } from "./input.ts";

export const EXAMPLE_PATH = new URL("../examples/demo-ballots.json", import.meta.url);

export function exampleRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")) as Record<string, unknown>;
}

export function exampleInput(): ReceiptsInput {
  return parseInput(exampleRaw());
}

/** Every contest title and selection name in the manifest: strings a receipt must never contain. */
export function choiceStrings(input: ReceiptsInput): string[] {
  return input.manifest.contests.flatMap((c) => [c.title, ...c.selections.map((s) => s.name)]);
}
