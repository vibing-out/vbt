import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

describe("Card", () => {
  test("default: raised surface, radius-md, shadow-card, padding 16/24px, no border", () => {
    render(<Card data-testid="c">Body</Card>);
    const cls = screen.getByTestId("c").className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["bg-surface-raised", "rounded-md", "shadow-card", "p-4", "md:p-6"]));
    expect(cls.some((c) => c === "border" || c.startsWith("border-"))).toBe(false);
  });

  test("hero: surface-inverse with on-inverse text at radius-lg", () => {
    render(<Card variant="hero" data-testid="c" />);
    const cls = screen.getByTestId("c").className.split(" ");
    expect(cls).toEqual(expect.arrayContaining(["bg-surface-inverse", "text-on-inverse", "rounded-lg"]));
    expect(cls).not.toContain("bg-surface-raised");
  });

  test("title and description follow the mode", () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Voter title</CardTitle>
            <CardDescription>Voter sentence.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
        <Card mode="admin" data-testid="admin">
          <CardTitle mode="admin">Admin title</CardTitle>
          <CardDescription mode="admin">Admin sentence.</CardDescription>
        </Card>
      </>,
    );
    expect(screen.getByText("Voter title").className).toContain("text-title");
    expect(screen.getByText("Voter sentence.").className).toContain("text-body-lg");
    expect(screen.getByText("Admin title").className).toContain("text-heading");
    expect(screen.getByText("Admin sentence.").className).toContain("text-body");
    expect(screen.getByTestId("admin").dataset.mode).toBe("admin");
  });

  test("title renders h2 by default and h3 on request", () => {
    render(
      <>
        <CardTitle>Default</CardTitle>
        <CardTitle level={3}>Nested</CardTitle>
      </>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Default" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Nested" })).toBeTruthy();
  });
});
