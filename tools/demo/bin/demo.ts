#!/usr/bin/env node
// Entry point for `demo seed` and `demo run` (see src/cli.ts). A separate file rather than an
// import.meta.main check, which Node 24.0 doesn't have.
import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
