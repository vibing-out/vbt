import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { type ChainedEvent, chainEvent, chainHead, eventHashInput, hashEvent, orderChain, verifyChain } from "./chain.ts";
import { canonicalJson } from "./canonical.ts";

const CODE = "RIVER-MAPLE-7Q4K-HAWK";

function sampleChain(): ChainedEvent[] {
  const cast = chainEvent(
    { tracking_code: CODE, event_type: "CAST", from_status: null, to_status: null, reason: null, occurred_on: "2026-11-03" },
    null,
  );
  const tallied = chainEvent(
    {
      tracking_code: CODE,
      event_type: "STATUS_CHANGE",
      from_status: "CAST",
      to_status: "TALLIED_PRECINCT",
      reason: null,
      occurred_on: "2026-11-03",
    },
    cast.hash,
  );
  const reported = chainEvent(
    {
      tracking_code: CODE,
      event_type: "STATUS_CHANGE",
      from_status: "TALLIED_PRECINCT",
      to_status: "REPORTED_UNOFFICIAL",
      reason: null,
      occurred_on: "2026-11-04",
    },
    tallied.hash,
  );
  return [cast, tallied, reported];
}

describe("hash input (C8)", () => {
  test("is canonical JSON of exactly the eight fields, with v: 1", () => {
    const [cast] = sampleChain();
    expect(eventHashInput(cast!)).toBe(
      '{"event_type":"CAST","from_status":null,"occurred_on":"2026-11-03","prev_hash":null,"reason":null,' +
        `"to_status":null,"tracking_code":"${CODE}","v":1}`,
    );
  });

  test("hash is lowercase hex SHA-256 of the UTF-8 input", () => {
    const [cast] = sampleChain();
    expect(cast!.hash).toBe(createHash("sha256").update(eventHashInput(cast!), "utf8").digest("hex"));
    expect(cast!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("ignores fields outside the hash input (time, actor, batch)", () => {
    const [cast] = sampleChain();
    const extra = { ...cast!, occurred_at: "2026-11-03T08:14:00Z", actor_id: "m-1", batch_id: "b" } as ChainedEvent;
    expect(hashEvent(extra)).toBe(cast!.hash);
  });

  test.each([
    ["tracking_code", ""],
    ["event_type", "DELETED"],
    ["from_status", "LOST"],
    ["to_status", "LOST"],
    ["reason", 7],
    ["occurred_on", "2026-11-03T08:00:00Z"],
    ["occurred_on", "2026-02-30"],
    ["prev_hash", "ABC"],
  ])("refuses %s = %j", (field, value) => {
    const [cast] = sampleChain();
    expect(() => hashEvent({ ...cast!, [field]: value } as ChainedEvent)).toThrow(TypeError);
  });
});

describe("verifyChain", () => {
  test("accepts a valid chain and the empty chain", () => {
    expect(verifyChain(sampleChain())).toEqual({ ok: true });
    expect(verifyChain([])).toEqual({ ok: true });
  });

  // AC3: changing any one hashed event field breaks verification at that event.
  test.each([
    ["event_type", "SPOILED"],
    ["from_status", "CHALLENGED"],
    ["to_status", "CERTIFIED"],
    ["reason", "edited"],
    ["occurred_on", "2026-11-05"],
    ["tracking_code", "RIVER-MAPLE-7Q4K-HAWX"],
  ])("AC3: changing %s on the middle event fails at index 1", (field, value) => {
    const chain = sampleChain();
    chain[1] = { ...chain[1]!, [field]: value } as ChainedEvent;
    expect(verifyChain(chain)).toEqual({ ok: false, index: 1 });
  });

  test("AC3: a re-hashed edited event still breaks the next link", () => {
    const chain = sampleChain();
    const edited = { ...chain[1]!, to_status: "CERTIFIED" as const };
    chain[1] = { ...edited, hash: hashEvent(edited) };
    expect(verifyChain(chain)).toEqual({ ok: false, index: 2 });
  });

  test("a first event with a prev_hash, a dropped event, or a reordered chain fails", () => {
    const [a, b, c] = sampleChain();
    expect(verifyChain([b!, c!])).toEqual({ ok: false, index: 0 });
    expect(verifyChain([a!, c!])).toEqual({ ok: false, index: 1 });
    expect(verifyChain([a!, c!, b!])).toEqual({ ok: false, index: 1 });
  });

  test("never throws on malformed input", () => {
    expect(verifyChain([null as unknown as ChainedEvent])).toEqual({ ok: false, index: 0 });
    expect(verifyChain("x" as unknown as ChainedEvent[])).toEqual({ ok: false, index: 0 });
    const [a] = sampleChain();
    expect(verifyChain([{ ...a!, occurred_on: "bad" }])).toEqual({ ok: false, index: 0 });
  });
});

describe("chain head and order (C9)", () => {
  test("the head is the event no other event points at, whatever the array order", () => {
    const chain = sampleChain();
    expect(chainHead([chain[2]!, chain[0]!, chain[1]!])).toBe(chain[2]);
    expect(orderChain([chain[2]!, chain[0]!, chain[1]!])).toEqual(chain);
  });

  test("no events, a fork, or a gap has no single head or order", () => {
    const [a, b, c] = sampleChain();
    const fork = { ...c!, hash: "f".repeat(64), prev_hash: a!.hash };
    expect(chainHead([])).toBeUndefined();
    expect(chainHead([a!, b!, fork])).toBeUndefined();
    expect(orderChain([a!, b!, fork])).toBeUndefined();
    expect(orderChain([a!, c!])).toBeUndefined();
  });
});

test("canonicalJson sorts keys recursively and refuses non-JSON values", () => {
  expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
  expect(() => canonicalJson({ a: new Date() })).toThrow(TypeError);
  expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
});
