import { expect, test } from "vitest";
import { trimTrailingSlashes } from "./url.ts";

test("trimTrailingSlashes drops every trailing slash and nothing else", () => {
  expect(trimTrailingSlashes("https://www.ballottrack.org")).toBe("https://www.ballottrack.org");
  expect(trimTrailingSlashes("https://www.ballottrack.org/")).toBe("https://www.ballottrack.org");
  expect(trimTrailingSlashes("https://example.test/app///")).toBe("https://example.test/app");
  expect(trimTrailingSlashes("///")).toBe("");
  expect(trimTrailingSlashes("")).toBe("");
});

test("trimTrailingSlashes stays linear on a long run of slashes", () => {
  const hostile = `https://example.test${"/".repeat(100_000)}x`;
  expect(trimTrailingSlashes(hostile)).toBe(hostile);
});
