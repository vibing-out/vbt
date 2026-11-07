#!/usr/bin/env node
// Entry for the `simulate` bin. tsx loads the TypeScript sources at runtime.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2));
