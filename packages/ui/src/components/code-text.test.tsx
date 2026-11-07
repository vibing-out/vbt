import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { CodeText } from "./code-text";

test("each group stays whole; a line may break only after a hyphen", () => {
  const { container } = render(<CodeText code="RIVER-MAPLE-7Q4K-HAWK" />);
  const root = container.querySelector<HTMLElement>('[data-slot="code"]')!;
  expect(root.textContent).toBe("RIVER-MAPLE-7Q4K-HAWK");
  expect([...root.querySelectorAll('[data-slot="code-group"]')].map((g) => g.className)).toEqual(
    Array(4).fill("whitespace-nowrap"),
  );
  // The break opportunities sit between groups, outside the no-wrap spans.
  expect(root.querySelectorAll(":scope > wbr")).toHaveLength(3);
});

test("code-lg on its own in voter mode, code in admin or inline", () => {
  const style = (el: HTMLElement) => el.querySelector('[data-slot="code"]')!.className;
  expect(style(render(<CodeText code="A-B" />).container)).toContain("text-code-lg");
  expect(style(render(<CodeText code="A-B" mode="admin" />).container)).toContain("text-code");
  expect(style(render(<CodeText code="A-B" size="inline" />).container)).not.toContain("text-code-lg");
});
