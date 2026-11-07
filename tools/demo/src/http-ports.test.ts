import { describe, expect, test } from "vitest";
import { httpPorts } from "./http-ports.ts";
import { ApiError } from "./ports.ts";

// AC 4: each port method is mapped to its locked method and path (docs/locked-interfaces.md § API boundaries).

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

function recorder(answer: (url: URL) => Response = () => Response.json({})) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ method: init?.method ?? "GET", url, headers: new Headers(init?.headers), body: init?.body });
    return answer(url);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const ports = (fetchImpl: typeof fetch, bypassSecret?: string) =>
  httpPorts({
    baseUrl: "https://app.example/",
    session: { authorization: "Bearer official-token" },
    supabaseUrl: "https://proj.supabase.co",
    publishableKey: "sb_publishable_x",
    fetch: fetchImpl,
    ...(bypassSecret ? { bypassSecret } : {}),
  });

const answers = (url: URL): Response => {
  if (url.pathname === "/api/events") return Response.json({ event_id: "ev-1" });
  if (url.pathname === "/api/batches") return Response.json({ batch_id: "b-1", count: 3 });
  if (url.pathname === "/api/reports/mismatches") return Response.json([{ challenge_id: "ch-1", tracking_code: "ABCD-1234" }]);
  if (url.pathname.endsWith("/resolve")) return Response.json({ status: "DISCARDED" });
  if (url.pathname.startsWith("/api/track/")) return Response.json({ status: "DISCARDED", reason: "why" });
  if (url.pathname === "/rest/v1/ballot_public") return Response.json([{ tracking_code: "ABCD-1234", current_status: "CAST", cast_date: "2026-11-03" }]);
  return new Response("no", { status: 404 });
};

describe("method and path per port", () => {
  test("every call goes to its locked endpoint", async () => {
    const { seen, fetchImpl } = recorder(answers);
    const api = ports(fetchImpl);
    expect(await api.uploadEventsFile({ name: "x.json", contentType: "application/json", body: "{}" })).toEqual({ eventId: "ev-1" });
    expect(await api.createBatch({ scope: "county", scopeId: "demo-aaaaaa-c", from: "TALLIED_PRECINCT", to: "REPORTED_UNOFFICIAL" })).toEqual({
      batchId: "b-1",
      count: 3,
    });
    expect(await api.listMismatches("demo-aaaaaa-c")).toEqual([{ challengeId: "ch-1", trackingCode: "ABCD-1234" }]);
    expect(await api.resolveChallenge("ch-1", { resolution: "rejected", reason: "r" })).toEqual({ status: "DISCARDED" });
    expect(await api.readTrack("ABCD-1234")).toEqual({ status: "DISCARDED", reason: "why" });
    expect(await api.readSet("demo-aaaaaa-p")).toEqual([{ trackingCode: "ABCD-1234", status: "CAST", castDate: "2026-11-03" }]);

    expect(seen.map((s) => `${s.method} ${s.url.origin}${s.url.pathname}`)).toEqual([
      "POST https://app.example/api/events",
      "POST https://app.example/api/batches",
      "GET https://app.example/api/reports/mismatches",
      "POST https://app.example/api/challenges/ch-1/resolve",
      "GET https://app.example/api/track/ABCD-1234",
      "GET https://proj.supabase.co/rest/v1/ballot_public",
    ]);
    expect(seen[0]!.body).toBeInstanceOf(FormData);
    expect(seen[1]!.url.search).toBe("?county=demo-aaaaaa-c");
    expect(JSON.parse(String(seen[1]!.body))).toEqual({
      scope: "county",
      scope_id: "demo-aaaaaa-c",
      from_status: "TALLIED_PRECINCT",
      to_status: "REPORTED_UNOFFICIAL",
    });
    expect(seen[2]!.url.search).toBe("?county=demo-aaaaaa-c");
    expect(JSON.parse(String(seen[3]!.body))).toEqual({ resolution: "rejected", reason: "r" });
    expect(seen[5]!.url.searchParams.get("precinct_id")).toBe("eq.demo-aaaaaa-p");
  });

  test("the official's session goes to official endpoints only, never the public tracker or the Data API", async () => {
    const { seen, fetchImpl } = recorder(answers);
    const api = ports(fetchImpl);
    await api.createBatch({ scope: "precinct", scopeId: "p", from: "CAST", to: "TALLIED_PRECINCT" });
    await api.readTrack("ABCD-1234");
    await api.readSet("p");
    expect(seen.map((s) => s.headers.get("authorization"))).toEqual(["Bearer official-token", null, null]);
    expect(seen[2]!.headers.get("apikey")).toBe("sb_publishable_x");
  });

  test("the bypass header is sent only when the secret is set", async () => {
    for (const [secret, expected] of [[undefined, null], ["s3cret", "s3cret"]] as const) {
      const { seen, fetchImpl } = recorder(answers);
      await ports(fetchImpl, secret).readTrack("ABCD-1234");
      expect(seen[0]!.headers.get("x-vercel-protection-bypass")).toBe(expected);
    }
  });
});

describe("failures", () => {
  test("a non-2xx answer is an ApiError with its status, and is not retried", async () => {
    const { seen, fetchImpl } = recorder(() => new Response("unsupported event type SPOILED", { status: 422 }));
    const error = await ports(fetchImpl)
      .uploadEventsFile({ name: "x", contentType: "application/json", body: "{}" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, message: expect.stringContaining("unsupported event type SPOILED") });
    expect(seen).toHaveLength(1);
  });

  test("a malformed answer is refused, not guessed at", async () => {
    const { fetchImpl } = recorder(() => Response.json({ status: "MAYBE" }));
    await expect(ports(fetchImpl).readTrack("x")).rejects.toMatchObject({ status: 502 });
    const { fetchImpl: noCount } = recorder(() => Response.json({ batch_id: "b" }));
    await expect(ports(noCount).createBatch({ scope: "precinct", scopeId: "p", from: "CAST", to: "TALLIED_PRECINCT" })).rejects.toThrow(/count/);
  });
});
