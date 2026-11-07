// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import GalleryPage, { metadata } from "./page";

const COMPONENTS = ["button", "input", "status-badge", "timeline", "card", "table", "receipt", "qr-frame"];
const STATUSES = ["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED", "CHALLENGED", "DISCARDED", "SPOILED"];
const MODES = ["voter", "admin"] as const;

function section(mode: (typeof MODES)[number]): HTMLElement {
  render(<GalleryPage />);
  return screen.getByTestId(`gallery-${mode}`);
}

describe.each(MODES)("gallery %s section", (mode) => {
  test("has the matching data-mode, on the section and every component in it", () => {
    const el = section(mode);
    expect(el.dataset.mode).toBe(mode);
    const modes = new Set([...el.querySelectorAll("[data-component]")].map((c) => c.getAttribute("data-mode")));
    expect([...modes]).toEqual([mode]);
  });

  test.each(COMPONENTS)("renders the %s component", (name) => {
    expect(section(mode).querySelector(`[data-component="${name}"]`)).not.toBeNull();
  });

  test("shows every status as a badge", () => {
    const el = section(mode);
    for (const status of STATUSES) {
      expect(el.querySelector(`[data-component="status-badge"][data-status="${status}"]`), status).not.toBeNull();
    }
  });

  test("shows the timeline on the hero and a light card, every exception, and both receipt forms", () => {
    const el = section(mode);
    for (const surface of ["hero", "raised"]) {
      expect(el.querySelector(`[data-component="timeline"][data-surface="${surface}"]`), surface).not.toBeNull();
    }
    for (const status of ["CHALLENGED", "DISCARDED", "SPOILED"]) {
      expect(el.querySelector(`[data-component="timeline"][data-off-path="${status}"]`), status).not.toBeNull();
    }
    for (const form of ["pass", "slip"]) {
      expect(el.querySelector(`[data-component="receipt"][data-form="${form}"]`), form).not.toBeNull();
    }
  });
});

describe("gallery copy rules", () => {
  test("no exclamation marks and no emoji", () => {
    const { container } = render(<GalleryPage />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("!");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test("voter sentences use body-lg", () => {
    const el = section("voter");
    const sentences = [...el.querySelectorAll("p")].filter((p) => /[.]$/.test(p.textContent?.trim() ?? ""));
    expect(sentences.length).toBeGreaterThan(5);
    for (const p of sentences) expect(p.className, p.textContent ?? "").toContain("text-body-lg");
  });

  test("no time of day appears anywhere: the hero card's Updated line is a date", () => {
    const { container } = render(<GalleryPage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/\b(?:AM|PM)\b/);
    expect(text).toContain("Updated Nov 3");
  });
});

test("the gallery is kept out of search results", () => {
  expect(metadata.robots).toMatchObject({ index: false });
});
