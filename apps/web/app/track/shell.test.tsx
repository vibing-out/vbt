import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TrackerShell } from "./shell";

test("the tracker footer links to the how-it-was-built page", () => {
  const html = renderToStaticMarkup(<TrackerShell>body</TrackerShell>);
  expect(html).toMatch(/<footer[^>]*>.*href="\/factory"/);
});
