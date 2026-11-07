import { expect, test } from "vitest";
import { placeholderStatus } from "./status";

test("placeholder status renders text", () => {
  expect(placeholderStatus()).toBe("VBT is being built");
});
