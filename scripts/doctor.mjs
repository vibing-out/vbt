#!/usr/bin/env node
// Checks that this machine matches the team setup. Run on both machines; any failure is drift.
// Usage: npm run doctor            (all checks)
//        npm run doctor -- --fast  (skips the slow MCP health check)
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// The Claude Code version both machines agreed on. Raise it together.
const MIN_CLAUDE_VERSION = "2.1.283";

const fast = process.argv.includes("--fast");
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

function run(cmd, args, timeout = 15_000) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function parseEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

// Node major version matches .nvmrc
if (existsSync(".nvmrc")) {
  const want = readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".")[0];
  const have = process.versions.node.split(".")[0];
  check("Node version", want === have, `need ${want}, have ${process.versions.node}`);
}

// Every variable in .env.example is set in .env.local
if (existsSync(".env.example")) {
  if (!existsSync(".env.local")) {
    check("Environment variables", false, ".env.local is missing");
  } else {
    const local = parseEnv(".env.local");
    const missing = Object.keys(parseEnv(".env.example")).filter((k) => !local[k]);
    check("Environment variables", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all set");
  }
}

// Claude Code is at least the agreed version
const claude = run("claude", ["--version"]);
const claudeVersion = claude.out.match(/\d+\.\d+\.\d+/)?.[0];
check(
  "Claude Code version",
  Boolean(claudeVersion) && compareVersions(claudeVersion, MIN_CLAUDE_VERSION) >= 0,
  claudeVersion ? `need ${MIN_CLAUDE_VERSION}+, have ${claudeVersion}` : "claude not found",
);

// GitHub CLI is logged in
const gh = run("gh", ["auth", "status"]);
check("GitHub CLI login", gh.ok, gh.ok ? "logged in" : "run: gh auth login");

// Every project MCP server is connected
if (!fast && existsSync(".mcp.json")) {
  const names = Object.keys(JSON.parse(readFileSync(".mcp.json", "utf8")).mcpServers ?? {});
  const list = run("claude", ["mcp", "list"], 120_000);
  for (const name of names) {
    const line = list.out.split("\n").find((l) => l.startsWith(`${name}:`));
    check(`MCP server: ${name}`, Boolean(line?.includes("Connected")), line ?? "not listed; run: claude mcp list");
  }
}

for (const r of results) console.log(`${r.ok ? "✔" : "✗"} ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed: this machine has drifted.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
