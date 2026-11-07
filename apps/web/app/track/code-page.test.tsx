import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { sampleCodes } from "../../lib/demo-election";

// /track/{code} serves two sources: demo-election codes render server-side on the design system, and any
// other code goes to the live tracker, which reads GET /api/track/{code} from the client.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const { default: TrackCodePage } = await import("./[code]/page");
const render = async (code: string) => renderToStaticMarkup(await TrackCodePage({ params: Promise.resolve({ code }) }));

test("a demo code renders its status server-side, not the live tracker", async () => {
  const [certified] = sampleCodes();
  const html = await render(certified!.code);
  expect(html).toContain('data-testid="track-result"');
  expect(html).toContain("Included in certified results");
  expect(html).not.toContain('data-testid="tracker"');
});

test("a lower-case demo code redirects to its canonical form", async () => {
  const [certified] = sampleCodes();
  await expect(render(certified!.code.toLowerCase())).rejects.toMatchObject({ url: `/track/${certified!.code}` });
});

test("any other code renders the live tracker shell and no demo result", async () => {
  const html = await render("SEED-0001");
  expect(html).toContain('data-testid="tracker"');
  expect(html).not.toContain('data-testid="track-result"');
});

test("a malformed percent-escape gets the live tracker's generic path, not a server error", async () => {
  const html = await render("%E0%A4%A");
  expect(html).toContain('data-testid="tracker"');
});
