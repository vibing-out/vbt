import { expect, test } from "@playwright/test";

// T-20 AC1 against the built app: an official endpoint refuses a caller who has not signed in, a
// garbage token and a malformed Authorization header. In CI there is no Supabase env, so this also
// proves the route fails closed without it.
const WHOAMI = "/api/official/whoami";

test("an official endpoint gets 403 without a multi-factor session @smoke", async ({ request }) => {
  for (const [path, headers] of [
    [WHOAMI, {}],
    [`${WHOAMI}?precinct=18097-001`, {}],
    [WHOAMI, { Authorization: "Bearer x" }],
    [WHOAMI, { Authorization: "Basic eDp4" }],
  ] as Array<[string, Record<string, string>]>) {
    const response = await request.get(path, { headers });
    expect(response.status(), `${path} ${JSON.stringify(headers)}`).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  }
});
