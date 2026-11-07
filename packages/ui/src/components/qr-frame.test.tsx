import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { QrFrame } from "./qr-frame";

function root(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-component="qr-frame"]')!;
}

describe("QrFrame", () => {
  test("on surface-inverse, radius-lg on wider screens, hidden in print", () => {
    const { container } = render(<QrFrame />);
    const el = root(container);
    expect(el.dataset.print).toBe("hide");
    expect(el.className.split(" ")).toEqual(expect.arrayContaining(["bg-surface-inverse", "sm:rounded-lg"]));
  });

  test("four 3px on-inverse corner brackets with radius-sm corners, and a 60% dim outside the square", () => {
    const { container } = render(<QrFrame />);
    const viewfinder = root(container).querySelector<HTMLElement>('[data-slot="viewfinder"]')!;
    expect(viewfinder.className).toContain("ring-surface-inverse/60");
    const corners = [...viewfinder.querySelectorAll<HTMLElement>("[data-corner]")];
    expect(corners).toHaveLength(4);
    for (const c of corners) {
      const cls = c.className.split(" ");
      expect(cls).toContain("border-on-inverse");
      expect(cls.filter((x) => /^border-[tblr]-3$/.test(x))).toHaveLength(2);
      expect(cls.some((x) => /^rounded-(tl|tr|bl|br)-sm$/.test(x))).toBe(true);
      expect(cls).not.toContain("border-brand-orange");
    }
  });

  test("on a valid read the corners turn brand-orange over duration-fast and the live region says so", () => {
    const { container } = render(<QrFrame state="found" />);
    for (const c of root(container).querySelectorAll<HTMLElement>("[data-corner]")) {
      expect(c.className.split(" ")).toEqual(expect.arrayContaining(["border-brand-orange", "duration-fast"]));
    }
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Code found, opening your ballot");
  });

  test("a wrong code shows above the viewfinder, in on-inverse, and scanning continues", () => {
    const { container } = render(<QrFrame state="wrong-code" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("That QR code isn't a VBT receipt.");
    expect(status.className).toContain("text-on-inverse");
    const preview = root(container).querySelector('[data-slot="preview"]')!;
    expect(status.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Point at the QR code on your slip.")).toBeTruthy();
  });

  test("the help line, in on-inverse body-lg; the live region is empty while scanning", () => {
    render(<QrFrame />);
    const help = screen.getByText("Point at the QR code on your slip.");
    expect(help.className.split(" ")).toEqual(expect.arrayContaining(["text-on-inverse", "text-body-lg"]));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  test('a top-right close button named "Close scanner" takes focus on open, and Escape closes', () => {
    const onClose = vi.fn();
    render(<QrFrame onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close scanner" });
    expect(close.querySelector("svg")?.getAttribute("data-icon")).toBe("x");
    expect(close.className.split(" ")).toEqual(
      expect.arrayContaining(["top-2", "right-2", "min-h-11", "min-w-11", "focus-visible:outline-focus-inverse"]),
    );
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    fireEvent.keyDown(close, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("focus returns to the trigger on close", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<QrFrame />);
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  test("focusOnOpen={false} leaves focus alone (static demos)", () => {
    render(<QrFrame focusOnOpen={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  test('"Type the code instead" calls onManualEntry, with a focus-inverse ring', () => {
    const onManualEntry = vi.fn();
    render(<QrFrame onManualEntry={onManualEntry} />);
    const link = screen.getByRole("button", { name: "Type the code instead" });
    const cls = link.className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["underline", "min-h-11", "focus-visible:outline-focus-inverse"]));
    expect(cls).not.toContain("focus-visible:outline-focus");
    fireEvent.click(link);
    expect(onManualEntry).toHaveBeenCalledTimes(1);
  });

  test("renders the camera view passed in, and admin mode", () => {
    const { container } = render(
      <QrFrame mode="admin">
        <video data-testid="video" />
      </QrFrame>,
    );
    expect(screen.getByTestId("video")).toBeTruthy();
    expect(root(container).dataset.mode).toBe("admin");
    expect(screen.getByRole("button", { name: "Type the code instead" }).className).toContain("text-body");
  });
});
