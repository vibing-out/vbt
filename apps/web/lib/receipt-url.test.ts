import { TRACKING_CODE_PATTERN } from "@vbt/crypto";
import { describe, expect, test } from "vitest";
import { parseReceiptQr } from "./receipt-url";

const opts = { hosts: ["www.ballottrack.org", "ballottrack.org", "localhost:3100"], codePattern: TRACKING_CODE_PATTERN };
const CODE = "BACHELOR-RANDOM-ERTX-CATEGORY";

describe("parseReceiptQr", () => {
  test.each([
    `https://www.ballottrack.org/track/${CODE}`,
    `https://ballottrack.org/track/${CODE}`,
    `https://WWW.BallotTrack.org/track/${CODE}`,
    `http://localhost:3100/track/${CODE}`,
    `  https://www.ballottrack.org/track/${CODE}\n`,
    `https://www.ballottrack.org/track/${CODE}?utm=x#top`,
  ])("accepts %j", (text) => {
    expect(parseReceiptQr(text, opts)).toBe(CODE);
  });

  test.each([
    ["another domain", `https://evil.example/track/${CODE}`],
    ["a lookalike subdomain", `https://www.ballottrack.org.evil.example/track/${CODE}`],
    ["a different port", `http://localhost:3000/track/${CODE}`],
    ["credentials in the URL", `https://user@www.ballottrack.org/track/${CODE}`],
    ["a non-web scheme", `javascript:alert(1)//www.ballottrack.org/track/${CODE}`],
    ["the receipt sub-page", `https://www.ballottrack.org/track/${CODE}/receipt`],
    ["a trailing slash", `https://www.ballottrack.org/track/${CODE}/`],
    ["another path", `https://www.ballottrack.org/status`],
    ["the bare tracker", `https://www.ballottrack.org/track`],
    ["a lowercase code", `https://www.ballottrack.org/track/${CODE.toLowerCase()}`],
    ["a malformed code", `https://www.ballottrack.org/track/NOT-A-REAL-CODE`],
    ["a code with a Crockford-excluded letter", `https://www.ballottrack.org/track/BACHELOR-RANDOM-ERTI-CATEGORY`],
    ["bad percent-encoding", `https://www.ballottrack.org/track/%E0%A4%A`],
    ["a bare code", CODE],
    ["plain text", "hello"],
    ["empty text", ""],
  ])("rejects %s", (_, text) => {
    expect(parseReceiptQr(text, opts)).toBeNull();
  });
});
