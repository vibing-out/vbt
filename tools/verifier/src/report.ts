// Text and JSON output. One line per check (PASS, FAIL or SKIP), then a
// summary. Lines hold check ids, scope ids, stage names, tracking codes,
// hashes, contest/choice ids and counts only: never a time, a leaf index, a
// ciphertext or a response body.

export type CheckId =
  | "published"
  | "signature"
  | "merkle-root"
  | "leaf-order"
  | "ballot-count"
  | "c2"
  | "c3"
  | "c4"
  | "chain"
  | "inclusion";

export type Status = "PASS" | "FAIL" | "SKIP";

/** `scope` is a scope_id, or the tracking code for chain and inclusion. `message` is empty on PASS. */
export type Check = { id: CheckId; scope: string; stage: string | null; status: Status; message: string };

export const EXIT = { PASS: 0, FAILED: 1, COULD_NOT_VERIFY: 2 } as const;

export const pass = (id: CheckId, scope: string, stage: string | null): Check => ({ id, scope, stage, status: "PASS", message: "" });
export const fail = (id: CheckId, scope: string, stage: string | null, message: string): Check => ({
  id,
  scope,
  stage,
  status: "FAIL",
  message,
});
export const skip = (id: CheckId, scope: string, stage: string | null, message: string): Check => ({
  id,
  scope,
  stage,
  status: "SKIP",
  message,
});

/** PASS when there are no failures, otherwise one FAIL per message. */
export function outcome(id: CheckId, scope: string, stage: string | null, failures: string[]): Check[] {
  return failures.length === 0 ? [pass(id, scope, stage)] : failures.map((m) => fail(id, scope, stage, m));
}

function label(c: Check): string {
  switch (c.id) {
    case "published":
      return `${c.scope}/${c.stage}`;
    case "c2":
    case "c3":
    case "c4":
      return `${c.id.toUpperCase()} ${c.scope}`;
    case "chain":
      return `chain ${c.scope}`;
    case "inclusion":
      return `inclusion ${c.scope} ${c.stage}`;
    default:
      return `${c.id} ${c.scope}/${c.stage}`;
  }
}

export function formatLine(c: Check): string {
  return `${c.status} ${label(c)}${c.message ? `: ${c.message}` : ""}`;
}

export const passed = (checks: Check[]): boolean => checks.every((c) => c.status !== "FAIL");

export function formatText(checks: Check[]): string {
  const count = (s: Status) => checks.filter((c) => c.status === s).length;
  const lines = checks.map(formatLine);
  lines.push(
    `${passed(checks) ? "PASSED" : "FAILED"}: ${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIP")} skipped`,
  );
  return `${lines.join("\n")}\n`;
}

export function formatJson(checks: Check[]): string {
  return `${JSON.stringify({ checks, passed: passed(checks) }, null, 2)}\n`;
}

export const exitCode = (checks: Check[]): number => (passed(checks) ? EXIT.PASS : EXIT.FAILED);
