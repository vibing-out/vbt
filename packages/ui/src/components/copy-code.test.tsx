import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CopyCode } from "./copy-code";

describe("CopyCode", () => {
  test("shows the code as passed in", () => {
    render(<CopyCode code="7KQ4-M2XR" />);
    expect(screen.getByText("7KQ4-M2XR")).toBeTruthy();
  });

  test("the copy button sits on surface-inverse, so its focus ring is focus-inverse", () => {
    render(<CopyCode code="7KQ4-M2XR" />);
    const cls = screen.getByRole("button", { name: "Copy code" }).className.split(" ");
    expect(cls).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-focus-inverse",
      ]),
    );
    expect(cls).not.toContain("focus-visible:outline-on-inverse");
    expect(cls).not.toContain("focus-visible:outline-focus");
  });

  test("voter targets are 44px, admin 36px", () => {
    const { rerender } = render(<CopyCode code="7KQ4-M2XR" />);
    expect(screen.getByRole("button").className).toContain("size-11");
    rerender(<CopyCode code="7KQ4-M2XR" mode="admin" />);
    expect(screen.getByRole("button").className).toContain("size-9");
  });
});
