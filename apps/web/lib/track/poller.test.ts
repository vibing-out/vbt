import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { backoffDelay, createPoller, type PollerDeps, retryAfterMs } from "./poller";
import type { TrackResult } from "./types";

const result = (status: TrackResult["status"], terminal = false): TrackResult => ({
  trackingCode: "SEED-0001",
  status,
  label: status,
  terminal,
  ciphertextHash: "ab",
  castDate: "2026-11-03",
  precinct: { id: "18097-001", name: "Center 1", countyId: "18097" },
  timeline: [{ status: "CAST", label: "Cast and sealed", date: "2026-11-03", reason: null }],
  stages: [],
});

// A Response stand-in whose body resolves in a microtask: a real Response body is a stream that fake
// timers don't flush.
const fakeResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ status, ok: status < 300, headers: new Headers(headers), json: async () => body }) as unknown as Response;

type Reply = TrackResult | number | "network" | "hang" | { status: 429; retryAfter: string };

/** A scripted API: each request takes the next reply (the last one repeats). */
function harness(replies: Reply[], latencyMs = 0) {
  let hidden = false;
  const listeners = new Set<() => void>();
  const requestTimes: number[] = [];
  const aborted: number[] = [];
  let active = 0;
  let maxActive = 0;
  let i = 0;
  const onData = vi.fn<(d: TrackResult) => void>();
  const onNotFound = vi.fn();
  const onRetrying = vi.fn<(ms: number) => void>();

  const request: PollerDeps["request"] = (signal) => {
    const reply = replies[Math.min(i++, replies.length - 1)]!;
    requestTimes.push(Date.now());
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise<Response>((resolve, reject) => {
      const done = () => {
        active--;
      };
      signal.addEventListener("abort", () => {
        aborted.push(Date.now());
        done();
        reject(new DOMException("aborted", "AbortError"));
      });
      if (reply === "hang") return;
      const settle = latencyMs === 0 ? (fn: () => void) => queueMicrotask(fn) : (fn: () => void) => setTimeout(fn, latencyMs);
      settle(() => {
        if (signal.aborted) return;
        done();
        if (reply === "network") return reject(new TypeError("network"));
        if (typeof reply === "number") return resolve(fakeResponse(reply, {}));
        if ("retryAfter" in reply) return resolve(fakeResponse(429, {}, { "Retry-After": reply.retryAfter }));
        resolve(fakeResponse(200, reply));
      });
    });
  };

  const poller = createPoller({
    request,
    onData,
    onNotFound,
    onRetrying,
    visibility: {
      isHidden: () => hidden,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
  });
  const setHidden = (value: boolean) => {
    hidden = value;
    listeners.forEach((cb) => cb());
  };
  const gaps = () => requestTimes.slice(1).map((t, k) => t - requestTimes[k]!);
  return { poller, requestTimes, aborted, onData, onNotFound, onRetrying, setHidden, gaps, maxActive: () => maxActive, listeners };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

test("fetches at once, then every 2 s while visible", async () => {
  const h = harness([result("CAST")]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.requestTimes).toEqual([0]);
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.requestTimes).toEqual([0, 2000, 4000, 6000]);
  expect(h.onData).toHaveBeenCalledTimes(4);
  h.poller.stop();
});

test("the interval counts from when a request starts", async () => {
  const h = harness([result("CAST")], 500);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(6100);
  expect(h.gaps().every((g) => g === 2000)).toBe(true);
  h.poller.stop();
});

test("a stage change reaches onData within 3 s", async () => {
  const h = harness([result("CAST"), result("TALLIED_PRECINCT")]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.onData).toHaveBeenLastCalledWith(expect.objectContaining({ status: "CAST" }));
  await vi.advanceTimersByTimeAsync(3000);
  expect(h.onData).toHaveBeenLastCalledWith(expect.objectContaining({ status: "TALLIED_PRECINCT" }));
  h.poller.stop();
});

test.each(["CERTIFIED", "DISCARDED", "SPOILED"] as const)("AC7: stops for good after %s", async (status) => {
  const h = harness([result("REPORTED_UNOFFICIAL"), result(status, true)]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.requestTimes).toEqual([0, 2000]);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.requestTimes).toEqual([0, 2000]);
  expect(h.listeners.size).toBe(0);
});

test("AC8: pauses while hidden (aborting the request) and fetches at once when visible", async () => {
  const h = harness([result("CAST")], 300);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(2100); // second request in flight
  h.setHidden(true);
  expect(h.aborted).toEqual([2100]);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(h.requestTimes).toEqual([0, 2000]);
  h.setHidden(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.requestTimes).toEqual([0, 2000, 22_100]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.requestTimes).toEqual([0, 2000, 22_100, 24_100]);
  h.poller.stop();
});

test("does not start polling while hidden; starts when the tab becomes visible", async () => {
  const h = harness([result("CAST")]);
  h.setHidden(true);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.requestTimes).toEqual([]);
  h.setHidden(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.requestTimes).toEqual([5000]);
  h.poller.stop();
});

test("AC9: backs off 2, 4, 8, 16, 30, 30 s after errors and returns to 2 s after a success", async () => {
  const h = harness([result("CAST"), 500, "network", 503, 502, 500, 500, result("CAST"), result("CAST")]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(2000 + 2000 + 4000 + 8000 + 16_000 + 30_000 + 30_000 + 2000);
  expect(h.gaps()).toEqual([2000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 2000]);
  expect(h.onRetrying.mock.calls.map((c) => c[0])).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
  h.poller.stop();
});

test("a request that hangs is aborted after 5 s and counts as an error", async () => {
  const h = harness(["hang", result("CAST")]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.aborted).toEqual([5000]);
  expect(h.onRetrying).toHaveBeenCalledWith(2000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.requestTimes).toEqual([0, 7000]);
  h.poller.stop();
});

test("AC9: a 429 waits Retry-After seconds", async () => {
  const h = harness([result("CAST"), { status: 429, retryAfter: "7" }, result("CAST")]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(2000 + 7000);
  expect(h.requestTimes).toEqual([0, 2000, 9000]);
  expect(h.onRetrying).toHaveBeenCalledWith(7000);
  h.poller.stop();
});

test("never overlaps requests, even when each one takes longer than the interval", async () => {
  const h = harness([result("CAST")], 3500);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(h.maxActive()).toBe(1);
  expect(h.gaps().every((g) => g === 3500)).toBe(true);
  h.poller.stop();
});

test("a 404 on the first load reports not found and stops", async () => {
  const h = harness([404]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.onNotFound).toHaveBeenCalledOnce();
  expect(h.requestTimes).toEqual([0]);
});

test("a 404 after data was shown keeps the last data and retries with backoff", async () => {
  const h = harness([result("CAST"), 404, result("TALLIED_PRECINCT")]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.onNotFound).not.toHaveBeenCalled();
  expect(h.onRetrying).toHaveBeenCalledWith(2000);
  expect(h.onData).toHaveBeenCalledTimes(2);
  expect(h.onData).toHaveBeenLastCalledWith(expect.objectContaining({ status: "TALLIED_PRECINCT" }));
  h.poller.stop();
});

test("a malformed 200 body is an error, not data", async () => {
  const h = harness([{ nope: true } as unknown as TrackResult]);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.onData).not.toHaveBeenCalled();
  expect(h.onRetrying).toHaveBeenCalledWith(2000);
  h.poller.stop();
});

test("stop() ends polling and aborts the request in flight", async () => {
  const h = harness([result("CAST")], 1000);
  h.poller.start();
  await vi.advanceTimersByTimeAsync(500);
  h.poller.stop();
  expect(h.aborted).toEqual([500]);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.requestTimes).toEqual([0]);
  expect(h.onData).not.toHaveBeenCalled();
});

test("backoffDelay and retryAfterMs", () => {
  expect([1, 2, 3, 4, 5, 6, 20].map(backoffDelay)).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  expect(retryAfterMs("12")).toBe(12_000);
  expect(retryAfterMs(null)).toBe(30_000);
  expect(retryAfterMs("soon")).toBe(30_000);
  expect(retryAfterMs("0")).toBe(1000);
  expect(retryAfterMs("99999")).toBe(300_000);
});
