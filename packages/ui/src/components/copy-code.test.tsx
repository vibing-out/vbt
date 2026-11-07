import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CopyCode } from "./copy-code";

describe("CopyCode", () => {
  test("shows the code as passed in, as selectable text", () => {
    const { container } = render(<CopyCode code="RIVER-MAPLE-7Q4K-HAWK" />);
    expect(container.querySelector('[data-slot="code"]')?.textContent).toBe("RIVER-MAPLE-7Q4K-HAWK");
  });

  test('a visible "Copy code" label; announces "Code copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyCode code="RIVER-MAPLE-7Q4K-HAWK" />);
    const button = screen.getByRole("button", { name: "Copy code" });
    expect(button.textContent).toBe("Copy code");
    await act(async () => fireEvent.click(button));
    expect(writeText).toHaveBeenCalledWith("RIVER-MAPLE-7Q4K-HAWK");
    expect(screen.getByRole("status").textContent).toBe("Code copied");
    expect(button.textContent).toBe("Code copied");
  });

  test("on surface-inverse (default) the ring is focus-inverse and the edge on-inverse-muted", () => {
    render(<CopyCode code="7KQ4-M2XR" />);
    const cls = screen.getByRole("button").className.split(" ");
    expect(cls).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-focus-inverse",
        "border-on-inverse-muted",
      ]),
    );
    expect(cls).not.toContain("focus-visible:outline-focus");
  });

  test("on a light card the ring is focus and the edge line-strong", () => {
    render(<CopyCode code="7KQ4-M2XR" surface="raised" />);
    const cls = screen.getByRole("button").className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["focus-visible:outline-focus", "border-line-strong", "text-ink"]));
  });

  test("voter targets are 44px, admin 36px", () => {
    const { rerender } = render(<CopyCode code="7KQ4-M2XR" />);
    expect(screen.getByRole("button").className).toContain("min-h-11");
    rerender(<CopyCode code="7KQ4-M2XR" mode="admin" />);
    expect(screen.getByRole("button").className).toContain("min-h-9");
  });
});
