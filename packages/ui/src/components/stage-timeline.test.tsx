import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StageTimeline, type StageEntry, type StageTimelineProps } from "./stage-timeline";

const TONIGHT: StageEntry[] = [
  // Deliberately out of order: the component renders the fixed order.
  { stage: "REPORTED_UNOFFICIAL", state: "current", date: "Nov 3" },
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "done", date: "Nov 3" },
  { stage: "CERTIFIED", state: "upcoming", expected: "Nov 18" },
];

const COUNTED: StageEntry[] = [
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "current", date: "Nov 3" },
];

function timeline(props: StageTimelineProps) {
  const utils = render(<StageTimeline {...props} />);
  const root = utils.container.querySelector<HTMLElement>('[data-component="timeline"]')!;
  const items = [...root.querySelectorAll<HTMLElement>("ol > li")];
  return { ...utils, root, items };
}

const dot = (li: HTMLElement) => li.querySelector<HTMLElement>('[data-slot="dot"]')!;
const spoken = (li: HTMLElement) => li.querySelector(".sr-only")?.textContent;
const visibleText = (li: HTMLElement) =>
  [...li.querySelectorAll<HTMLElement>("span[aria-hidden=true] > span")].map((s) => s.textContent).filter(Boolean);

describe.each(["raised", "hero"] as const)("StageTimeline on %s", (surface) => {
  test("an ordered list of the four stages, in fixed order, with visible labels", () => {
    const { root, items } = timeline({ stages: TONIGHT, surface });
    expect(root.querySelector("ol")).toBeTruthy();
    expect(items.map((li) => li.dataset.stage)).toEqual(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"]);
    expect(items.map((li) => visibleText(li)[0])).toEqual(["Cast and sealed", "Counted at precinct", "Now", "Certified"]);
  });

  test('the current stage: aria-current="step", the "Now" eyebrow above its label, and its date', () => {
    const { items } = timeline({ stages: TONIGHT, surface });
    const current = items.filter((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]?.dataset.stage).toBe("REPORTED_UNOFFICIAL");
    expect(visibleText(current[0]!)).toEqual(["Now", "Election-night results", "Nov 3"]);
    expect(current[0]?.querySelector(".text-label.uppercase")?.textContent).toBe("Now");
    // Only the current stage says "Now".
    expect(items.filter((li) => li.textContent?.includes("Now"))).toHaveLength(1);
  });

  test("each item reads in full: stage number, label, state and date", () => {
    const { items } = timeline({ stages: TONIGHT, surface });
    expect(items.map(spoken)).toEqual([
      "Stage 1 of 4, Cast and sealed, done, Nov 3.",
      "Stage 2 of 4, Counted at precinct, done, Nov 3.",
      "Stage 3 of 4, Election-night results, current, Nov 3.",
      "Stage 4 of 4, Certified, upcoming, expected by Nov 18.",
    ]);
    // Dots and the visible text are decorative; the meaning is in the spoken text.
    for (const li of items) expect(dot(li).closest('[aria-hidden="true"]')).toBeTruthy();
  });

  test('upcoming stages show "Expected by", never a time of day anywhere', () => {
    const { root, items } = timeline({ stages: TONIGHT, surface });
    expect(visibleText(items[3]!)).toEqual(["Certified", "Expected by Nov 18"]);
    expect(root.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  test("16px dots: done has a cut-out check, upcoming is an empty ring", () => {
    const { items } = timeline({ stages: TONIGHT, surface });
    for (const li of items) expect(dot(li).className).toContain("size-4");
    expect(dot(items[0]!).querySelector("svg")?.getAttribute("data-icon")).toBe("check");
    expect(dot(items[3]!).className).toContain("border-2");
    expect(dot(items[3]!).querySelector("svg")).toBeNull();
  });

  test("the track fills up to the current stage over duration-slow, instantly under reduced motion", () => {
    const { items } = timeline({ stages: TONIGHT, surface });
    const tracks = items.map((li) => li.querySelector<HTMLElement>('[data-slot="track"]'));
    expect(tracks.map((t) => t?.dataset.filled ?? null)).toEqual(["true", "true", "false", null]);
    const fill = tracks[0]!.firstElementChild!.className.split(" ");
    expect(fill).toEqual(expect.arrayContaining(["duration-slow", "ease-out", "motion-reduce:transition-none"]));
    expect(fill).not.toContain("duration-base");
    expect(tracks[0]!.className).toContain("w-0.5");
  });

  test("a stage date with a time of day is refused", () => {
    expect(() =>
      render(<StageTimeline surface={surface} stages={[{ stage: "CAST", state: "done", date: "Nov 3, 7:14 AM" }]} />),
    ).toThrow(/no time of day/);
    expect(() =>
      render(<StageTimeline surface={surface} stages={[{ stage: "CERTIFIED", state: "upcoming", expected: "9:00" }]} />),
    ).toThrow(/no time of day/);
  });
});

describe("StageTimeline colors (README Anatomy)", () => {
  test("light card: done ink, current accent-mark with an accent-tint halo, upcoming line-strong; labels", () => {
    const { items } = timeline({ stages: TONIGHT });
    expect(dot(items[0]!).className).toContain("bg-ink");
    expect(dot(items[2]!).className.split(" ")).toEqual(expect.arrayContaining(["bg-accent-mark", "ring-6", "ring-accent-tint"]));
    expect(dot(items[3]!).className).toContain("border-line-strong");
    const label = (li: HTMLElement) => [...li.querySelectorAll("span")].find((s) => s.textContent === visibleText(li).find((t) => t !== "Now"))!;
    expect(label(items[2]!).className.split(" ")).toEqual(expect.arrayContaining(["text-accent-text", "font-semibold", "text-body-lg"]));
    expect(label(items[0]!).className).toContain("text-ink-muted");
    expect(label(items[3]!).className).toContain("text-ink-muted");
    expect(items[0]!.querySelector('[data-slot="track"] > span')?.className).toContain("bg-stage-done");
  });

  test("hero card: done on-inverse, current brand-orange with a 30% halo, upcoming on-inverse-muted; horizontal from 30rem", () => {
    const { root, items } = timeline({ stages: TONIGHT, surface: "hero" });
    expect(dot(items[0]!).className).toContain("bg-on-inverse");
    expect(dot(items[2]!).className.split(" ")).toEqual(expect.arrayContaining(["bg-brand-orange", "ring-brand-orange/30"]));
    expect(dot(items[3]!).className).toContain("border-on-inverse-muted");
    expect(items[2]!.innerHTML).toContain("text-brand-orange");
    expect(items[0]!.querySelector('[data-slot="track"] > span')?.className).toContain("bg-on-inverse-muted");
    expect(root.className).toContain("@container");
    expect(root.querySelector("ol")?.className).toContain("@min-[30rem]:grid-flow-col");
  });

  test("the light card stays vertical", () => {
    const { root } = timeline({ stages: TONIGHT });
    expect(root.className).not.toContain("@container");
    expect(root.querySelector("ol")?.className).toBe("flex flex-col");
  });

  test("never brand-orange on a light card", () => {
    const { root } = timeline({ stages: TONIGHT });
    expect(root.innerHTML).not.toContain("brand-orange");
  });
});

describe("StageTimeline exceptions", () => {
  test("CHALLENGED: the held stage becomes Under review with a flag and the reason; later stages stay upcoming", () => {
    const { items } = timeline({ stages: COUNTED, offPath: { status: "CHALLENGED", reason: "Signature check" } });
    expect(items.map((li) => li.dataset.state)).toEqual(["done", "challenged", "upcoming", "upcoming"]);
    const held = items[1]!;
    expect(held.getAttribute("aria-current")).toBe("step");
    expect(visibleText(held)).toEqual(["Now", "Under review", "Signature check"]);
    expect(dot(held).className).toContain("bg-status-challenged");
    expect(dot(held).querySelector("svg")?.getAttribute("data-icon")).toBe("flag");
    expect(spoken(held)).toBe("Stage 2 of 4, Counted at precinct, under review, Signature check.");
  });

  test("CHALLENGED with no current stage holds the last one done", () => {
    const { items } = timeline({
      stages: [{ stage: "CAST", state: "done", date: "Nov 3" }],
      offPath: { status: "CHALLENGED", reason: "Mismatch" },
    });
    expect(items.map((li) => li.dataset.state)).toEqual(["challenged", "upcoming", "upcoming", "upcoming"]);
  });

  test('DISCARDED: the track stops, later stages are removed and a terminal "Not counted" node ends it', () => {
    const { root, items } = timeline({
      stages: COUNTED,
      offPath: { status: "DISCARDED", reason: "arrived after the deadline", date: "Nov 5" },
    });
    expect(items.map((li) => li.dataset.state)).toEqual(["done", "done", "discarded"]);
    expect(root.textContent).not.toMatch(/Certified|Election-night|upcoming/);
    const terminal = items[2]!;
    expect(terminal.getAttribute("aria-current")).toBe("step");
    expect(visibleText(terminal)).toEqual(["Now", "Not counted: arrived after the deadline", "Nov 5"]);
    expect(dot(terminal).className).toContain("bg-status-discarded");
    expect(dot(terminal).querySelector("svg")?.getAttribute("data-icon")).toBe("x");
    expect(spoken(terminal)).toBe("Not counted: arrived after the deadline, Nov 5.");
    // The track to the terminal node is filled; nothing runs past it.
    expect(items[1]!.querySelector<HTMLElement>('[data-slot="track"]')?.dataset.filled).toBe("true");
    expect(terminal.querySelector('[data-slot="track"]')).toBeNull();
  });

  test("on the hero, exception dots are on-inverse (status colors fail on surface-inverse in light)", () => {
    const { items } = timeline({ stages: COUNTED, surface: "hero", offPath: { status: "DISCARDED", reason: "late" } });
    expect(dot(items[2]!).className).toContain("bg-on-inverse");
    expect(items[2]!.innerHTML).not.toMatch(/status-/);
  });

  test("SPOILED: no timeline, the Spoiled badge and the replacement ballot link", () => {
    const { root } = timeline({
      stages: COUNTED,
      offPath: { status: "SPOILED", replacement: { code: "OAK-FERN-2M8P-WREN", href: "/track/OAK-FERN-2M8P-WREN" } },
    });
    expect(root.querySelector("ol")).toBeNull();
    expect(root.querySelector('[data-component="status-badge"]')?.getAttribute("data-status")).toBe("SPOILED");
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/track/OAK-FERN-2M8P-WREN");
    expect(link.textContent).toBe("Track your replacement ballotOAK-FERN-2M8P-WREN");
    expect(link.className).toContain("min-h-11");
  });

  test("SPOILED without a replacement shows only the badge", () => {
    const { root } = timeline({ stages: [], offPath: { status: "SPOILED" } });
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("Status: Spoiled");
  });
});

describe("StageTimeline states", () => {
  test("loading: four upcoming rings and skeleton labels, no spinner", () => {
    const { root, items } = timeline({ stages: TONIGHT, loading: true });
    expect(root.querySelector("ol")?.getAttribute("aria-busy")).toBe("true");
    expect(items).toHaveLength(4);
    for (const li of items) {
      expect(li.dataset.state).toBe("upcoming");
      expect(dot(li).className).toContain("border-2");
      expect(li.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    }
    expect(spoken(items[0]!)).toBe("Stage 1 of 4, loading.");
    expect(root.querySelector('[class*="animate-spin"]')).toBeNull();
  });

  test('live update: a newly reached stage is announced politely, once', () => {
    const { rerender, container } = render(<StageTimeline stages={COUNTED} />);
    const region = container.querySelector('[role="status"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    rerender(<StageTimeline stages={TONIGHT} />);
    expect(region.textContent).toBe("Your ballot moved to Election-night results.");
  });

  test("admin: body-size labels; labels can be overridden", () => {
    const { items } = timeline({ stages: [], mode: "admin", labels: { CAST: "Emitida y sellada" } });
    expect(spoken(items[0]!)).toBe("Stage 1 of 4, Emitida y sellada, upcoming.");
    expect(items[0]!.innerHTML).toContain("text-body");
    expect(items[0]!.innerHTML).not.toContain("text-body-lg");
  });
});
