import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  test("label is uppercase label style and linked by htmlFor/id", () => {
    render(<Input id="code" label="Tracking code" />);
    const input = screen.getByLabelText("Tracking code");
    expect(input.id).toBe("code");
    const label = screen.getByText("Tracking code");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe("code");
    expect(label.className).toContain("text-label");
    expect(label.className).toContain("uppercase");
  });

  test("has a line-strong edge and the focus ring", () => {
    render(<Input id="a" label="Name of precinct" />);
    const cls = screen.getByLabelText("Name of precinct").className;
    expect(cls).toContain("border-line-strong");
    expect(cls).toContain("focus-visible:outline-focus");
  });

  test('aria-invalid="true" applies the status-discarded ring, and the error is described', () => {
    render(<Input id="c" label="Code" error="We couldn't find that code. Check it against your receipt." />);
    const input = screen.getByLabelText("Code");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("aria-invalid:ring-status-discarded");
    expect(input.className).toContain("aria-invalid:border-status-discarded");
    expect(input.getAttribute("aria-describedby")).toBe("c-error");
    expect(document.getElementById("c-error")?.textContent).toContain("We couldn't find that code");
  });

  test("valid inputs are not marked invalid; a hint is described", () => {
    render(<Input id="h" label="Code" hint="Letters A to Z and numbers 2 to 9." />);
    const input = screen.getByLabelText("Code");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe("h-hint");
  });

  test("the code variant is mono; voter inputs are at least 44px tall", () => {
    render(
      <>
        <Input id="v" label="Voter code" variant="code" />
        <Input id="a" label="Admin code" variant="code" mode="admin" />
      </>,
    );
    const voter = screen.getByLabelText("Voter code");
    const admin = screen.getByLabelText("Admin code");
    expect(voter.className).toContain("font-mono");
    expect(voter.className).toContain("min-h-11");
    expect(voter.className).toContain("text-code-lg");
    expect(voter.className).not.toContain("text-body-lg");
    expect(admin.className).toContain("font-mono");
    expect(admin.className).toContain("text-code");
    expect(admin.className).not.toContain("min-h-11");
    expect(voter.getAttribute("spellcheck")).toBe("false");
  });

  test("voter hint sentences are body-lg", () => {
    render(<Input id="h" label="Code" hint="Letters A to Z." />);
    expect(screen.getByText("Letters A to Z.").className).toContain("text-body-lg");
  });
});
