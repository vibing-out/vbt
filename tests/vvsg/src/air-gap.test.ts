// VVSG 2.0 air gap and one-way data flow (T-19). Principle 7: nothing connects a voting system to us,
// and ingest is only an authenticated official's file upload. Every outbound call in product code must
// be one we know about and that talks to our own Supabase; no code touches a device or wireless API.
// The upload route itself (POST /api/events) arrives with T-05 #15.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { findDeviceApis, findOutboundCalls, listSourceFiles, nonGetHandlers } from "./support/source-scan.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");

/** Product code. scripts/ is factory tooling, not product; tests/ is test code. */
const SCANNED_ROOTS = ["apps/web", "packages/*/src", "tools/*/src", "supabase/lib", "supabase/scripts"];

/** Every scanned file with an outbound call, and why. A new call site, or a stale entry, fails. */
const OUTBOUND_ALLOWLIST: Record<string, string> = {
  "apps/web/app/official/demo/demo-control.tsx": "same-origin: calls this app's own /api routes",
  "apps/web/lib/product-db.ts": "our own Supabase: reads app_info through the Data API",
  "apps/web/app/official/demo/demo-control.tsx": "same-origin calls to VBT's own API (demo driver); never a voting system",
  "tools/demo/src/cli.ts": "same-origin calls to VBT's own API (demo driver); never a voting system",
  "tools/demo/src/http-ports.ts": "same-origin calls to VBT's own API (demo driver); never a voting system",
  "apps/web/lib/context-log.ts": "our own Supabase: the team's context-log project",
  "apps/web/lib/require-role.ts": "our own Supabase: Auth session, role and MFA check",
  "apps/web/lib/service-db.ts": "our own Supabase: service-role RPCs for ingest and batches (T-05)",
  "supabase/scripts/seed-demo-officials.ts": "our own Supabase: creates the demo officials (run by a human)",
  "tools/demo/src/cli.ts": "same-origin: calls this app's own /api routes",
  "tools/demo/src/http-ports.ts": "same-origin: calls this app's own /api routes",
  "tools/verifier/src/cli.ts": "public verifier: read-only download of the published record from the --base-url a citizen gives",
};

const files = listSourceFiles(REPO, SCANNED_ROOTS);
const read = (file: string) => readFileSync(join(REPO, file), "utf8");

describe("findOutboundCalls and findDeviceApis", () => {
  test.each([
    ["fetch(", 'const r = await fetch("https://example.org");'],
    ["a node:http import", 'import http from "node:http";'],
    ["a bare https import", 'import { request } from "https";'],
    ["new WebSocket(", 'const s = new WebSocket("wss://example.org");'],
    ["navigator.serial", "await navigator.serial.requestPort();"],
    ["a Supabase client", "const db = createClient(url, key);"],
    ["an axios require", 'const axios = require("axios");'],
    ["a dynamic undici import", 'const { request } = await import("undici");'],
  ])("flags %s", (_name, source) => {
    expect(findOutboundCalls(source)).not.toEqual([]);
  });

  test("does not flag plain code, or names that only contain the words", () => {
    const plain = [
      'import { readFileSync } from "node:fs";',
      "const fetchImpl = deps.fetcher;",
      'const label = "prefetch";',
      "export function transition(from, to) { return from !== to; }",
    ].join("\n");
    expect(findOutboundCalls(plain)).toEqual([]);
    expect(findDeviceApis(plain)).toEqual([]);
  });

  test.each([
    ["navigator.usb", "navigator.usb.getDevices();"],
    ["navigator.bluetooth", "navigator.bluetooth.requestDevice({});"],
    ["navigator?.hid", "navigator?.hid.getDevices();"],
    ["serialport", 'import { SerialPort } from "serialport";'],
    ["node-hid", 'const HID = require("node-hid");'],
    ["usb", 'import { usb } from "usb";'],
  ])("flags the device or wireless API %s", (_name, source) => {
    expect(findDeviceApis(source)).not.toEqual([]);
    expect(findOutboundCalls(source)).not.toEqual([]);
  });
});

describe("product code", () => {
  test("the scan sees the product code (not vacuous)", () => {
    expect(files).toEqual(expect.arrayContaining(Object.keys(OUTBOUND_ALLOWLIST)));
    expect(files).toContain("packages/domain/src/transition.ts");
    expect(files.filter((f) => /\.(test|spec)\./.test(f) || f.includes("/e2e/") || f.includes("node_modules"))).toEqual([]);
  });

  test("the files with outbound calls are exactly the allowlist", () => {
    const calling = files.filter((file) => findOutboundCalls(read(file)).length > 0);
    expect(calling).toEqual(Object.keys(OUTBOUND_ALLOWLIST).sort());
  });

  test("no file uses a device or wireless API", () => {
    const offenders = files.flatMap((file) => findDeviceApis(read(file)).map((api) => `${file}: ${api}`));
    expect(offenders).toEqual([]);
  });
});

describe("public routes are read-only", () => {
  const API = join(REPO, "apps", "web", "app", "api");

  function routeFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return routeFiles(path);
      return /^route\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
    });
  }

  test.each([
    ["export async function POST", "export async function POST(request) {}", ["POST"]],
    ["export const PUT", "export const PUT = handler;", ["PUT"]],
    ["export { x as DELETE }", "export { GET, remove as DELETE };", ["DELETE"]],
    ["export *", 'export * from "./handlers";', ["export *"]],
    ["only GET", "export async function GET(request) { return Response.json({}); }", []],
  ])("the handler check: %s", (_name, source, expected) => {
    expect(nonGetHandlers(source)).toEqual(expected);
  });

  // The tracker and the published record (locked § API boundaries) take no input but the URL. Neither
  // exists yet (T-08 #18); the check covers them as soon as they land.
  test("every route under api/track/ and api/record/ exports only GET", () => {
    const routes = [...routeFiles(join(API, "track")), ...routeFiles(join(API, "record"))];
    const offenders = routes.flatMap((file) =>
      nonGetHandlers(readFileSync(file, "utf8")).map((method) => `${relative(REPO, file)}: ${method}`),
    );
    expect(offenders).toEqual([]);
  });
});
