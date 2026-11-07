import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

function sample(mode: "voter" | "admin" = "admin") {
  return render(
    <Table mode={mode}>
      <TableHeader>
        <TableRow>
          <TableHead>Precinct</TableHead>
          <TableHead numeric>Ballots</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Precinct 12</TableCell>
          <TableCell numeric>1,204</TableCell>
        </TableRow>
        <TableRow selected data-testid="selected">
          <TableCell>Precinct 14</TableCell>
          <TableCell numeric>988</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table", () => {
  test("headers are muted 13px label style", () => {
    sample();
    const th = screen.getByRole("columnheader", { name: "Precinct" });
    expect(th.className).toContain("text-label");
    expect(th.className).toContain("text-ink-muted");
    expect(th.getAttribute("scope")).toBe("col");
  });

  test("rows are separated by line dividers; selected rows sit on accent-tint", () => {
    sample();
    const rows = screen.getAllByRole("row");
    for (const row of rows) expect(row.className).toContain("border-line");
    const selected = screen.getByTestId("selected");
    expect(selected.dataset.selected).toBe("true");
    expect(selected.className).toContain("data-[selected=true]:bg-accent-tint");
    expect(rows[1]?.hasAttribute("data-selected")).toBe(false);
  });

  test("numeric cells use tabular numbers", () => {
    sample();
    expect(screen.getByText("1,204").className).toContain("tabular-nums");
    expect(screen.getByText("Precinct 12").className).not.toContain("tabular-nums");
  });

  test("the wrapper scrolls sideways and the header is sticky", () => {
    const { container } = sample();
    const wrap = container.querySelector<HTMLElement>('[data-component="table"]')!;
    expect(wrap.className).toContain("overflow-x-auto");
    expect(container.querySelector("thead")?.className).toContain("sticky");
    expect(container.querySelector("thead")?.className).toContain("top-0");
  });

  test("modes set the text size", () => {
    const { container } = sample("voter");
    expect(container.querySelector("table")?.className).toContain("text-body-lg");
    expect(container.querySelector<HTMLElement>('[data-component="table"]')?.dataset.mode).toBe("voter");
  });
});
