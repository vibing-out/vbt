import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { STAGES } from "../status";
import { StageTimeline, type StageEntry, type StageTimelineProps } from "./stage-timeline";

const STAGES_TONIGHT: StageEntry[] = [
  // Deliberately out of order: the component renders the fixed order.
  { stage: "REPORTED_UNOFFICIAL", state: "current", date: "Nov 3" },
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "done", date: "Nov 3" },
];

const HERO = {
  form: "hero",
  stages: STAGES_TONIGHT,
  headline: "Your ballot is in tonight's results",
  nextStep: "Counties certify up to about 2 weeks after Election Day.",
  code: "RIVER-MAPLE-7Q4K-HAWK",
  county: "Marion County",
  precinct: "Precinct 12",
  updatedAt: "9:42 PM",
} as const satisfies StageTimelineProps;

const FORMS: StageTimelineProps[] = [
  HERO,
  { form: "history", stages: STAGES_TONIGHT, nextStep: "Counties certify up to about 2 weeks after Election Day." },
  { form: "compact", stages: STAGES_TONIGHT, mode: "admin" },
];

function root(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-component="timeline"]')!;
}

describe.each(FORMS)("StageTimeline $form", (props) => {
  test("renders the four stages in fixed order", () => {
    const { container } = render(<StageTimeline {...props} />);
    const items = [...root(container).querySelectorAll("li[data-stage]")].map((li) => li.getAttribute("data-stage"));
    expect(items).toEqual([...STAGES]);
  });

  test('marks the current stage with aria-current="step"', () => {
    const { container } = render(<StageTimeline {...props} />);
    const current = root(container).querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("data-stage")).toBe("REPORTED_UNOFFICIAL");
  });

  test("each rail circle has an accessible name with its state", () => {
    render(<StageTimeline {...props} />);
    const counted = props.mode === "admin" ? "Counted" : "Counted at precinct";
    expect(screen.getByRole("img", { name: `${counted}, done` })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /, (done|current|upcoming)$/ })).toHaveLength(4);
    expect(screen.getByRole("img", { name: /certified.*, upcoming$/i })).toBeTruthy();
  });

  test("no stage date shows a time of day", () => {
    const { container } = render(<StageTimeline {...props} />);
    for (const li of root(container).querySelectorAll("li")) expect(li.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  test("off the path: later stages are upcoming, never in a status color, and the reason shows", () => {
    const { container } = render(
      <StageTimeline {...props} offPath={{ status: "CHALLENGED", reason: "signature check pending" }} />,
    );
    const el = root(container);
    const states = [...el.querySelectorAll("li[data-stage]")].map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "upcoming", "upcoming"]);
    expect(el.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    for (const li of el.querySelectorAll("li")) expect(li.outerHTML).not.toMatch(/status-/);
    const badge = el.querySelector<HTMLElement>('[data-component="status-badge"]');
    expect(badge?.dataset.status).toBe("CHALLENGED");
    expect(badge?.textContent).toContain("signature check pending");
  });

  test("only the newly completed circle animates, never under reduced motion", () => {
    const { container } = render(<StageTimeline {...props} justCompleted="TALLIED_PRECINCT" />);
    const animated = root(container).querySelectorAll<HTMLElement>('[data-new="true"]');
    expect(animated).toHaveLength(1);
    const cls = animated[0]!.className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["duration-base", "ease-out", "motion-reduce:transition-none"]));
    expect(animated[0]!.getAttribute("aria-label")).toMatch(/, done$/);
  });
});

describe("StageTimeline hero", () => {
  test("headline in display style, then the reason badge, eyebrow with the update time", () => {
    const { container } = render(
      <StageTimeline {...HERO} offPath={{ status: "DISCARDED", reason: "arrived after the deadline" }} />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.className).toContain("text-display");
    expect(heading.textContent).toBe(HERO.headline);
    // The badge comes right after the headline.
    expect(heading.nextElementSibling?.querySelector('[data-component="status-badge"]')).toBeTruthy();
    expect(screen.getByText(/Updated 9:42 PM/).textContent).toBe("Marion County · Precinct 12 · Updated 9:42 PM");
    expect(root(container).className).toContain("bg-surface-inverse");
    expect(screen.getByText(HERO.code).className).toContain("font-mono");
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  test("the current circle is brand-orange; done is on-inverse; upcoming outlined", () => {
    render(<StageTimeline {...HERO} />);
    expect(screen.getByRole("img", { name: /results, current$/ }).className).toContain("bg-brand-orange");
    expect(screen.getByRole("img", { name: "Cast and sealed, done" }).className).toContain("bg-on-inverse");
    expect(screen.getByRole("img", { name: /certified results, upcoming$/ }).className).toContain("border-2");
  });

  test("the only time on the card is the Updated time", () => {
    const { container } = render(<StageTimeline {...HERO} />);
    const times = (root(container).textContent ?? "").match(/\d{1,2}:\d{2}/g);
    expect(times).toEqual(["9:42"]);
  });

  test("a stage date with a time of day is refused", () => {
    expect(() =>
      render(<StageTimeline {...HERO} stages={[{ stage: "CAST", state: "done", date: "Nov 3, 7:14 AM" }]} />),
    ).toThrow(/no time of day/);
  });

  test("voter sentences are body-lg; admin uses body", () => {
    const { rerender } = render(<StageTimeline {...HERO} />);
    expect(screen.getByText(HERO.nextStep).className).toContain("text-body-lg");
    rerender(<StageTimeline {...HERO} mode="admin" />);
    expect(screen.getByText(HERO.nextStep).className).toContain("text-body");
    expect(screen.getByText(HERO.nextStep).className).not.toContain("text-body-lg");
  });
});

describe("StageTimeline history and compact", () => {
  test("history: the current row sits on accent-tint and carries the note", () => {
    const { container } = render(<StageTimeline {...FORMS[1]!} />);
    const current = root(container).querySelector<HTMLElement>('[aria-current="step"]')!;
    expect(current.className).toContain("bg-accent-tint");
    expect(within(current).getByText(/certify/)).toBeTruthy();
    expect(root(container).className).toContain("shadow-card");
  });

  test("compact: done ink, current accent-mark, upcoming surface-sunk segments", () => {
    render(<StageTimeline form="compact" stages={STAGES_TONIGHT} mode="admin" />);
    expect(screen.getByRole("img", { name: "Cast, done" }).className).toContain("bg-ink");
    expect(screen.getByRole("img", { name: "Election night, current" }).className).toContain("bg-accent-mark");
    expect(screen.getByRole("img", { name: "Certified, upcoming" }).className).toContain("bg-surface-sunk");
  });

  test("a missing stage is upcoming; labels can be overridden", () => {
    render(<StageTimeline form="compact" stages={[]} labels={{ CAST: "Emitida y sellada" }} />);
    expect(screen.getByRole("img", { name: "Emitida y sellada, upcoming" })).toBeTruthy();
  });
});
