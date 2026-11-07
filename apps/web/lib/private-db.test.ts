import { expect, test } from "vitest";
import { withServiceRoleReadOnly } from "./private-db";

test("without PRODUCT_DATABASE_URL it throws before connecting and never runs the callback", async () => {
  let ran = false;
  await expect(
    withServiceRoleReadOnly(async () => {
      ran = true;
    }, {}),
  ).rejects.toThrow("PRODUCT_DATABASE_URL is not set");
  expect(ran).toBe(false);
});
