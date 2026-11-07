import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { QrFrame } from "./qr-frame";

function root(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-component="qr-frame"]')!;
}

describe("QrFrame", () => {
  test("a 220px viewfinder with four brand-orange corner brackets, hidden in print", () => {
    const { container } = render(<QrFrame />);
    const el = root(container);
    expect(el.dataset.print).toBe("hide");
    expect(el.className).toContain("bg-surface-inverse");
    expect(el.className).toContain("rounded-lg");
    const viewfinder = el.querySelector(".size-55");
    expect(viewfinder).toBeTruthy();
    const corners = viewfinder!.querySelectorAll("[data-corner]");
    expect(corners).toHaveLength(4);
    for (const c of corners) expect(c.className).toContain("border-brand-orange");
  });

  test("shows one help line while scanning", () => {
    const { container } = render(<QrFrame />);
    const lines = root(container).querySelectorAll("p");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe("Point your camera at the QR code on your receipt.");
    expect(lines[0]?.className).toContain("text-body-lg");
  });

  test('"Type the code instead" is a button that calls onManualEntry', () => {
    const onManualEntry = vi.fn();
    render(<QrFrame onManualEntry={onManualEntry} />);
    const button = screen.getByRole("button", { name: "Type the code instead" });
    expect(button.className).toContain("min-h-11");
    // The focus ring stays visible on the dark panel.
    const cls = button.className.split(" ");
    expect(cls).toContain("focus-visible:outline-focus-inverse");
    expect(cls).not.toContain("focus-visible:outline-focus");
    fireEvent.click(button);
    expect(onManualEntry).toHaveBeenCalledTimes(1);
  });

  test('state="found" shows "Receipt found" and the code in mono', () => {
    render(<QrFrame state="found" code="RIVER-MAPLE-7Q4K-HAWK" />);
    expect(screen.getByRole("status").textContent).toContain("Receipt found");
    expect(screen.getByText("RIVER-MAPLE-7Q4K-HAWK").className).toContain("font-mono");
    expect(screen.queryByText(/Point your camera/)).toBeNull();
  });

  test("renders the camera view passed in and the admin mode", () => {
    const { container } = render(
      <QrFrame mode="admin">
        <video data-testid="video" />
      </QrFrame>,
    );
    expect(screen.getByTestId("video")).toBeTruthy();
    expect(root(container).dataset.mode).toBe("admin");
    expect(screen.getByRole("button").className).toContain("text-body");
  });
});
