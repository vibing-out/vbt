import { describe, expect, it } from "vitest";
import { DEFAULT_TRACKER_BASE_URL, normalizeBaseUrl, printedWebAddress, trackerBaseUrl, trackerUrl } from "./config.ts";

describe("tracker URL", () => {
  it("defaults to the production tracker", () => {
    expect(trackerBaseUrl({})).toBe(DEFAULT_TRACKER_BASE_URL);
    expect(trackerBaseUrl({ RECEIPT_TRACKER_BASE_URL: " " })).toBe(DEFAULT_TRACKER_BASE_URL);
  });

  it("reads RECEIPT_TRACKER_BASE_URL and drops a trailing slash", () => {
    expect(trackerBaseUrl({ RECEIPT_TRACKER_BASE_URL: "https://preview.example.app/" })).toBe(
      "https://preview.example.app",
    );
    expect(normalizeBaseUrl("https://county.example.gov/vote/")).toBe("https://county.example.gov/vote");
  });

  it("builds <base>/track/<code>", () => {
    expect(trackerUrl("https://www.ballottrack.org", "SEED-0001")).toBe("https://www.ballottrack.org/track/SEED-0001");
    expect(trackerUrl("https://county.example.gov/vote/", "A-B")).toBe("https://county.example.gov/vote/track/A-B");
  });

  it("prints a short web address without the scheme", () => {
    expect(printedWebAddress("https://www.ballottrack.org")).toBe("www.ballottrack.org/track");
    expect(printedWebAddress("https://county.example.gov/vote/")).toBe("county.example.gov/vote/track");
  });

  it("rejects base URLs that would corrupt the link", () => {
    expect(() => normalizeBaseUrl("not a url")).toThrow(/not a valid URL/);
    expect(() => normalizeBaseUrl("ftp://example.org")).toThrow(/http\(s\)/);
    expect(() => normalizeBaseUrl("https://example.org/?a=1")).toThrow(/query/);
    expect(() => normalizeBaseUrl("https://example.org/#x")).toThrow(/fragment/);
  });
});
