// Static scan for outbound network calls and device or wireless APIs (locked-interfaces Principle 7:
// "nothing connects a voting system to us"; VVSG 2.0 bans wireless). Pure functions over source text,
// plus a file lister. A list of patterns is easy to widen.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const NETWORK_MODULES = ["http", "https", "http2", "net", "tls", "dgram"];
const NETWORK_PACKAGES = ["ws", "axios", "undici", "node-fetch", "got"];
const DEVICE_PACKAGES = ["serialport", "@serialport/[\\w-]+", "node-hid", "usb"];

/** `import ... from "x"`, `import "x"`, `import("x")`, `require("x")` and `export ... from "x"` for any listed module. */
function importOf(modules: readonly string[]): RegExp {
  const names = modules.join("|");
  return new RegExp(`(?:\\bfrom|\\bimport|\\brequire\\s*\\(|\\bimport\\s*\\()\\s*["'](?:${names})(?:/[^"']*)?["']`);
}

const DEVICE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["navigator device API", /\bnavigator\s*\??\.\s*(?:serial|usb|bluetooth|hid)\b/],
  ["device package import", importOf(DEVICE_PACKAGES)],
];

const OUTBOUND_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["fetch(", /\bfetch\s*\(/],
  ["Supabase client", /\bcreate(?:Server|Browser)?Client\s*\(/],
  ["new WebSocket", /\bnew\s+WebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["network module import", importOf(NETWORK_MODULES.map((m) => `(?:node:)?${m}`))],
  ["network package import", importOf(NETWORK_PACKAGES)],
  ...DEVICE_PATTERNS,
];

function matches(source: string, patterns: ReadonlyArray<[string, RegExp]>): string[] {
  return patterns.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

/** Labels of every kind of outbound call (network or device) in a source file; empty when none. */
export function findOutboundCalls(source: string): string[] {
  return matches(source, OUTBOUND_PATTERNS);
}

/** Labels of every device or wireless API in a source file; empty when none. */
export function findDeviceApis(source: string): string[] {
  return matches(source, DEVICE_PATTERNS);
}

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS = new Set(["node_modules", ".next", "e2e", "coverage", "dist"]);
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

/**
 * Product source files under `roots` (repo-relative; a `/*` segment expands to each subdirectory, as
 * in `packages/*` + `/src`), as sorted repo-relative paths with forward slashes. Skips tests, build
 * output and dependencies. Missing roots are ignored (tools/ arrives with epic/4).
 */
export function listSourceFiles(repoRoot: string, roots: readonly string[]): string[] {
  const dirs = roots.flatMap((root) => expandRoot(repoRoot, root));
  const files = dirs.flatMap((dir) => walk(dir));
  return [...new Set(files.map((file) => relative(repoRoot, file).split("\\").join("/")))].sort();
}

function expandRoot(repoRoot: string, root: string): string[] {
  const star = root.indexOf("/*");
  if (star === -1) return existsSync(join(repoRoot, root)) ? [join(repoRoot, root)] : [];
  const parent = join(repoRoot, root.slice(0, star));
  const rest = root.slice(star + 2);
  if (!existsSync(parent)) return [];
  return readdirSync(parent)
    .filter((name) => statSync(join(parent, name)).isDirectory())
    .map((name) => join(parent, name, rest))
    .filter((dir) => existsSync(dir));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : walk(path);
    return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [path] : [];
  });
}

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

/** HTTP handlers a Next.js route file exports other than GET, in any export form. */
export function nonGetHandlers(source: string): string[] {
  const found = new Set<string>();
  const declared = new RegExp(`export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var)\\s+(${METHODS})\\b`, "g");
  for (const m of source.matchAll(declared)) found.add(m[1]!);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (new RegExp(`^(?:${METHODS})$`).test(name)) found.add(name);
    }
  }
  // `export * from` can re-export any handler, so it can't be shown to be GET-only.
  if (/export\s*\*/.test(source)) found.add("export *");
  return [...found].filter((method) => method !== "GET").sort();
}
