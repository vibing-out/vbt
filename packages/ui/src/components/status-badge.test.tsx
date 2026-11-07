import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BALLOT_STATUSES, type BallotStatus } from "../status";
import { PlainBadge, StatusBadge, type StatusBadgeProps } from "./status-badge";

// StatusBadge README, Variants, word for word.
const README: Record<BallotStatus, { label: string; dot: string; fill: string; text: string; icon?: string }> = {
  CAST: { label: "Cast", dot: "bg-ink-muted", fill: "bg-surface-sunk", text: "text-ink" },
  TALLIED_PRECINCT: { label: "Counted at precinct", dot: "bg-ink", fill: "bg-surface-sunk", text: "text-ink" },
  REPORTED_UNOFFICIAL: { label: "Election-night results", dot: "bg-accent-mark", fill: "bg-accent-tint", text: "text-ink" },
  CERTIFIED: { label: "Certified", dot: "bg-ink", fill: "bg-stage-done", text: "text-ink", icon: "check" },
  CHALLENGED: {
    label: "Under review",
    dot: "bg-status-challenged",
    fill: "bg-status-challenged-bg",
    text: "text-status-challenged",
    icon: "flag",
  },
  DISCARDED: {
    label: "Not counted",
    dot: "bg-status-discarded",
    fill: "bg-status-discarded-bg",
    text: "text-status-discarded",
    icon: "x",
  },
  SPOILED: {
    label: "Spoiled",
    dot: "bg-status-spoiled",
    fill: "bg-status-spoiled-bg",
    text: "text-status-spoiled",
    icon: "undo-2",
  },
};

function badge(props: StatusBadgeProps): HTMLElement {
  const { container } = render(<StatusBadge {...props} />);
  return container.querySelector<HTMLElement>('[data-component="status-badge"]')!;
}

const visible = (el: HTMLElement) => el.textContent?.replace("Status: ", "");

describe.each(BALLOT_STATUSES)("StatusBadge %s", (status) => {
  const spec = README[status];

  test("voter: an 8px dot, the README label, fill and text, 14px weight 600", () => {
    const el = badge({ status });
    expect(visible(el)).toBe(spec.label);
    expect(el.dataset.status).toBe(status);
    const cls = el.className.split(" ");
    expect(cls).toEqual(expect.arrayContaining([spec.fill, spec.text, "text-small", "font-semibold"]));
    const dot = el.querySelector<HTMLElement>('[data-slot="dot"]');
    expect(dot?.className.split(" ")).toEqual(expect.arrayContaining(["size-2", "rounded-pill", spec.dot]));
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector("svg")).toBeNull();
  });

  test("admin: small weight 500; the README icon at 14px in place of the dot, if it has one", () => {
    const el = badge({ status, mode: "admin" });
    expect(visible(el)).toBe(spec.label);
    expect(el.className.split(" ")).toEqual(expect.arrayContaining([spec.fill, spec.text, "text-small", "font-medium"]));
    const icon = el.querySelector("svg");
    if (spec.icon) {
      expect(icon?.getAttribute("data-icon")).toBe(spec.icon);
      expect(icon?.getAttribute("width")).toBe("14");
      expect(icon?.getAttribute("stroke-width")).toBe("1.5");
      expect(el.querySelector('[data-slot="dot"]')).toBeNull();
    } else {
      expect(icon).toBeNull();
      expect(el.querySelector('[data-slot="dot"]')?.className).toContain(spec.dot);
    }
  });
});

describe("StatusBadge anatomy and behavior", () => {
  test("radius-pill, space-1 by space-2 padding, no border, never wraps", () => {
    const cls = badge({ status: "CAST" }).className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["rounded-pill", "px-2", "py-1", "gap-1", "whitespace-nowrap"]));
    expect(cls.some((c) => c === "border" || c.startsWith("border-"))).toBe(false);
    expect(cls.some((c) => c === "truncate")).toBe(false);
  });

  test("screen readers read \"Status: <label>\"", () => {
    expect(badge({ status: "CHALLENGED" }).textContent).toBe("Status: Under review");
    expect(badge({ status: "CHALLENGED" }).querySelector(".sr-only")?.textContent).toBe("Status: ");
  });

  test("cross-fades over duration-base, instantly under reduced motion", () => {
    const cls = badge({ status: "CAST" }).className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["duration-base", "ease-out", "motion-reduce:transition-none"]));
  });

  test("label override (Spanish strings)", () => {
    expect(visible(badge({ status: "CAST", label: "Emitida" }))).toBe("Emitida");
  });

  test("plain: surface-sunk with no dot or icon", () => {
    const { container } = render(<PlainBadge>Uploaded Nov 3</PlainBadge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.dataset.variant).toBe("plain");
    expect(el.className).toContain("bg-surface-sunk");
    expect(el.querySelector("svg, [data-slot=dot]")).toBeNull();
    expect(el.textContent).toBe("Uploaded Nov 3");
  });
});
