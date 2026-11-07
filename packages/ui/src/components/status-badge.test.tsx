import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BALLOT_STATUSES, type BallotStatus } from "../status";
import { PlainBadge, StatusBadge, type StatusBadgeProps } from "./status-badge";

const VOTER: Record<BallotStatus, string> = {
  CAST: "Cast and sealed",
  TALLIED_PRECINCT: "Counted at precinct",
  REPORTED_UNOFFICIAL: "Included in election-night results",
  CERTIFIED: "Included in certified results",
  CHALLENGED: "Under review",
  DISCARDED: "Not counted",
  SPOILED: "Spoiled by voter to check the machine; not counted",
};
const ADMIN: Record<BallotStatus, string> = {
  CAST: "Cast",
  TALLIED_PRECINCT: "Counted",
  REPORTED_UNOFFICIAL: "Election night",
  CERTIFIED: "Certified",
  CHALLENGED: "Challenged",
  DISCARDED: "Discarded",
  SPOILED: "Spoiled",
};
const ICON: Record<BallotStatus, string> = {
  CAST: "lock",
  TALLIED_PRECINCT: "check",
  REPORTED_UNOFFICIAL: "chart",
  CERTIFIED: "badge-check",
  CHALLENGED: "flag",
  DISCARDED: "x-circle",
  SPOILED: "rotate-ccw",
};
const COLORS: Record<BallotStatus, string[]> = {
  CAST: ["bg-stage-done", "text-ink"],
  TALLIED_PRECINCT: ["bg-stage-done", "text-ink"],
  REPORTED_UNOFFICIAL: ["bg-stage-done", "text-ink"],
  CERTIFIED: ["bg-stage-done", "text-ink"],
  CHALLENGED: ["bg-status-challenged-bg", "text-status-challenged"],
  DISCARDED: ["bg-status-discarded-bg", "text-status-discarded"],
  SPOILED: ["bg-status-spoiled-bg", "text-status-spoiled"],
};

function propsFor(status: BallotStatus, mode: "voter" | "admin"): StatusBadgeProps {
  if (status === "CHALLENGED" || status === "DISCARDED") return { status, mode, reason: "arrived after deadline" };
  return { status, mode } as StatusBadgeProps;
}

function badge(props: StatusBadgeProps): HTMLElement {
  const { container } = render(<StatusBadge {...props} />);
  return container.querySelector<HTMLElement>('[data-component="status-badge"]')!;
}

describe("StatusBadge: every status in both modes", () => {
  const cases = BALLOT_STATUSES.flatMap((status) => (["voter", "admin"] as const).map((mode) => ({ status, mode })));

  test.each(cases)("$status in $mode mode", ({ status, mode }) => {
    const el = badge(propsFor(status, mode));
    const label = (mode === "voter" ? VOTER : ADMIN)[status];
    expect(el.textContent?.startsWith(label)).toBe(true);
    expect(el.dataset.status).toBe(status);
    expect(el.dataset.mode).toBe(mode);
    const icon = el.querySelector("svg");
    expect(icon?.getAttribute("data-icon")).toBe(ICON[status]);
    // Badge icons are 16px in both modes.
    expect(icon?.getAttribute("width")).toBe("16");
    expect(icon?.getAttribute("stroke-width")).toBe("1.75");
    for (const cls of COLORS[status]) expect(el.className.split(" ")).toContain(cls);
    expect(el.className).toContain("rounded-pill");
    expect(el.className).toContain(mode === "voter" ? "text-body-lg" : "text-small");
  });
});

describe("StatusBadge rules", () => {
  test("Challenged and Discarded require a reason (type check and runtime)", () => {
    // @ts-expect-error: CHALLENGED needs a reason
    expect(() => render(<StatusBadge status="CHALLENGED" />)).toThrow(/reason/);
    // @ts-expect-error: DISCARDED needs a reason
    expect(() => render(<StatusBadge status="DISCARDED" />)).toThrow(/reason/);
    expect(() => render(<StatusBadge status="DISCARDED" reason="  " />)).toThrow(/reason/);
  });

  test("the detail follows a middle dot in regular weight", () => {
    const discarded = badge({ status: "DISCARDED", reason: "arrived after deadline" });
    expect(discarded.textContent).toBe("Not counted · arrived after deadline");
    const cast = badge({ status: "CAST", detail: "Nov 3" });
    expect(cast.textContent).toBe("Cast and sealed · Nov 3");
    expect(cast.querySelector(".font-normal")?.textContent).toBe(" · Nov 3");
  });

  test("current: accent-text on accent-tint with the stage's own icon", () => {
    const el = badge({ status: "TALLIED_PRECINCT", state: "current" });
    expect(el.dataset.state).toBe("current");
    expect(el.className).toContain("bg-accent-tint");
    expect(el.className).toContain("text-accent-text");
    expect(el.querySelector("svg")?.getAttribute("data-icon")).toBe("check");
  });

  test("pending (admin): ink-muted on surface-sunk with a clock", () => {
    const el = badge({ status: "REPORTED_UNOFFICIAL", state: "pending", mode: "admin" });
    expect(el.className).toContain("bg-surface-sunk");
    expect(el.className).toContain("text-ink-muted");
    expect(el.querySelector("svg")?.getAttribute("data-icon")).toBe("clock");
  });

  test("plain: surface-sunk with no icon", () => {
    const { container } = render(<PlainBadge>Uploaded tonight</PlainBadge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.dataset.variant).toBe("plain");
    expect(el.className).toContain("bg-surface-sunk");
    expect(el.querySelector("svg")).toBeNull();
    expect(el.textContent).toBe("Uploaded tonight");
  });

  test("label override (Spanish strings)", () => {
    expect(badge({ status: "CAST", label: "Emitida y sellada" }).textContent).toBe("Emitida y sellada");
  });
});
