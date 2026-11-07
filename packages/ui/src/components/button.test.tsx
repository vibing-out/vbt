import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  test("primary is brand-orange with on-accent text, rendered as a <button>", () => {
    render(<Button>Track my ballot</Button>);
    const button = screen.getByRole("button", { name: "Track my ballot" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("bg-brand-orange");
    expect(button.className).toContain("text-on-accent");
  });

  test("secondary has a line-strong edge", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("border");
    expect(cls).toContain("border-line-strong");
    expect(cls).not.toContain("bg-brand-orange");
  });

  test.each(["primary", "secondary"] as const)("%s has the 2px focus ring at 2px offset", (variant) => {
    render(<Button variant={variant}>Go</Button>);
    const cls = screen.getByRole("button").className.split(" ");
    expect(cls).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-focus",
      ]),
    );
  });

  test("voter buttons are at least 44px tall; admin buttons are denser", () => {
    render(
      <>
        <Button>Voter</Button>
        <Button mode="admin">Admin</Button>
      </>,
    );
    const voter = screen.getByRole("button", { name: "Voter" });
    const admin = screen.getByRole("button", { name: "Admin" });
    expect(voter.className).toContain("min-h-12");
    expect(voter.className).toContain("text-body-lg");
    expect(voter.dataset.mode).toBe("voter");
    expect(admin.className).not.toContain("min-h-11");
    expect(admin.className).not.toContain("min-h-12");
    expect(admin.className).toContain("text-body");
    expect(admin.dataset.mode).toBe("admin");
  });

  test("the voter primary button is at least 48px tall; voter secondary stays at 44px", () => {
    render(
      <>
        <Button>Check ballot</Button>
        <Button variant="secondary">Scan</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "Check ballot" }).className.split(" ");
    expect(primary).toContain("min-h-12");
    expect(primary).not.toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Scan" }).className.split(" ")).toContain("min-h-11");
  });

  test("asChild renders the child element with button styles", () => {
    render(
      <Button asChild>
        <a href="/track">Track</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Track" });
    expect(link.tagName).toBe("A");
    expect(link.className).toContain("bg-brand-orange");
    expect(link.hasAttribute("type")).toBe(false);
    expect(link.dataset.component).toBe("button");
  });
});

test("inverse buttons (on dark heroes) switch the focus ring to focus-inverse", () => {
  render(<Button inverse>Track</Button>);
  const cls = screen.getByRole("button").className.split(" ");
  expect(cls).toContain("focus-visible:outline-focus-inverse");
  expect(cls).not.toContain("focus-visible:outline-on-inverse");
  expect(cls).not.toContain("focus-visible:outline-focus");
  expect(cls).toContain("focus-visible:outline-2");
});
