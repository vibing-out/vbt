// Writes src/styles/tokens.css from src/tokens/tokens.json. Run: pnpm --filter @vbt/ui tokens
import { readFileSync, writeFileSync } from "node:fs";
import { generateTokensCss } from "../src/tokens/generate.ts";
import type { TokenFile } from "../src/tokens/types.ts";

const tokensPath = new URL("../src/tokens/tokens.json", import.meta.url);
const cssPath = new URL("../src/styles/tokens.css", import.meta.url);

const tokens = JSON.parse(readFileSync(tokensPath, "utf8")) as TokenFile;
writeFileSync(cssPath, generateTokensCss(tokens));
console.log(`Wrote ${cssPath.pathname}`);
