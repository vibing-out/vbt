import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

// AC6: no sign-up, email or phone collection. The tracker's own source (pages, client component, copy
// and logic) never mentions them, and the entry page has exactly one input: the code.
const web = join(import.meta.dirname, "..", "..");
const TRACKER_DIRS = ["app/track", "app/api/track", "lib/track"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

// Exact strings that name these words without collecting anything: the entry page saying none are
// needed, and the printed receipt's county helpline and QR instructions (voter-journey receipt mockup).
const ALLOWED = [
  "No account, email or phone number.",
  'phone="1-800-555-0100"',
  "Scan its QR code with a phone to open",
];

test("the tracker source has no sign-up, email or phone wording or fields", () => {
  const files = TRACKER_DIRS.flatMap((d) => sources(join(web, d)));
  expect(files.length).toBeGreaterThan(5);
  for (const file of files) {
    const source = ALLOWED.reduce((text, allowed) => text.replaceAll(allowed, ""), readFileSync(file, "utf8"));
    expect(source, relative(web, file)).not.toMatch(/e-?mail|phone|\btel\b|sign[ -]?up|register|password|account/i);
  }
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

test("the entry page has exactly one text input, the code, and no email or tel input", async () => {
  const { default: TrackEntryPage } = await import("./page");
  const html = renderToStaticMarkup(await TrackEntryPage({ searchParams: Promise.resolve({}) }));
  const inputs = html.match(/<input[^>]*>/g) ?? [];
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatch(/name="code"/);
  expect(inputs[0]).toMatch(/type="text"/);
  expect(html).not.toMatch(/type="(email|tel|password)"/);
  expect(html).toMatch(/<form[^>]*action="\/track"[^>]*method="get"/);
});

test("/track?code= redirects to the normalised /track/{CODE}", async () => {
  const { default: TrackEntryPage } = await import("./page");
  await expect(TrackEntryPage({ searchParams: Promise.resolve({ code: " seed 0001 " }) })).rejects.toMatchObject({
    url: "/track/SEED-0001",
  });
});

test("/track/{code} redirects a lower-case code to its canonical form and renders a canonical one", async () => {
  const { default: TrackCodePage } = await import("./[code]/page");
  await expect(TrackCodePage({ params: Promise.resolve({ code: "seed-0001" }) })).rejects.toMatchObject({
    url: "/track/SEED-0001",
  });
  const html = renderToStaticMarkup(await TrackCodePage({ params: Promise.resolve({ code: "SEED-0001" }) }));
  expect(html).toContain("SEED-0001");
  expect(html).toContain("<noscript>");
});
