// Write a simulation to disk with canonical JSON.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compare } from "./formats/manifest.ts";
import type { SimulationOutput } from "./types.ts";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * Write every file under `outDir`, creating directories as needed. Existing
 * tool outputs with the same path are overwritten; nothing else is deleted.
 */
export async function writeOutput(outDir: string, output: SimulationOutput): Promise<string[]> {
  const paths = [...output.files.keys()].sort(compare);
  for (const rel of paths) {
    const abs = join(outDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, canonicalJson(output.files.get(rel)));
  }
  return paths;
}
