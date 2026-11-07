// @vitest-environment node
import { describe, expect, test } from "vitest";
import { dateOnly, iconSize } from "./mode";
import { cn } from "./utils";

describe("cn", () => {
  test("keeps a token text size next to a token text color", () => {
    expect(cn("text-display text-ink")).toBe("text-display text-ink");
  });

  test("a later text size replaces an earlier one", () => {
    expect(cn("text-body-lg", "text-code-lg")).toBe("text-code-lg");
    expect(cn("rounded-sm", "rounded-pill")).toBe("rounded-pill");
    expect(cn("outline-focus", "outline-on-inverse")).toBe("outline-on-inverse");
  });
});

describe("mode helpers", () => {
  test("icon size", () => {
    expect(iconSize("voter")).toBe(20);
    expect(iconSize("admin")).toBe(16);
  });

  test("dateOnly rejects a time of day", () => {
    expect(dateOnly("Nov 3", "x")).toBe("Nov 3");
    expect(dateOnly(undefined, "x")).toBeUndefined();
    expect(() => dateOnly("Nov 3, 9:42 AM", "x")).toThrow(/no time of day/);
  });
});
