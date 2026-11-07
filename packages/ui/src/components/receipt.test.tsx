import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { Receipt, RECEIPT_PROMISE, type ReceiptProps, type ReceiptSlipProps } from "./receipt";

const COMMON = {
  county: "Marion County",
  election: "General Election",
  electionDate: "Nov 3, 2026",
  precinct: "Precinct 12",
  code: "RIVER-MAPLE-7Q4K-HAWK",
  qr: <svg data-testid="qr" />,
};

const SLIP: ReceiptSlipProps = {
  ...COMMON,
  form: "slip",
  trackUrl: "vote.marion.in.gov/track",
  phone: "1-800-555-0100",
};

const TIME = /\d{1,2}:\d{2}/;

test("the promise line is the mockup's, word for word", () => {
  expect(RECEIPT_PROMISE).toBe("This code shows your ballot's progress. It does not show how you voted.");
});

describe("Receipt pass", () => {
  function pass(extra: Partial<Extract<ReceiptProps, { form?: "pass" }>> = {}) {
    const { container } = render(<Receipt {...COMMON} status="CAST" {...extra} />);
    return container.querySelector<HTMLElement>('[data-component="receipt"]')!;
  }

  test('a section headed "Your ballot receipt", on a surface-inverse card, radius-lg, shadow-overlay, max 380px', () => {
    const root = pass();
    expect(root.tagName).toBe("SECTION");
    expect(screen.getByRole("region", { name: "Your ballot receipt" })).toBe(root);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Your ballot receipt");
    expect(root.className).toContain("max-w-95");
    const card = root.querySelector<HTMLElement>(".vbt-pass")!;
    expect(card.className.split(" ")).toEqual(
      expect.arrayContaining(["bg-surface-inverse", "text-on-inverse", "rounded-lg", "shadow-overlay"]),
    );
  });

  test("top band: county and election in on-inverse-muted label style, StatusBadge on the right", () => {
    const root = pass();
    const top = screen.getByText("Marion County General Election");
    expect(top.className.split(" ")).toEqual(expect.arrayContaining(["text-label", "text-on-inverse-muted"]));
    const badge = top.parentElement!.querySelector<HTMLElement>('[data-component="status-badge"]')!;
    expect(badge.dataset.status).toBe("CAST");
    expect(top.nextElementSibling).toBe(badge);
    expect(root.querySelectorAll('[data-component="status-badge"]')).toHaveLength(1);
  });

  test("middle: the code in code-lg, groups never split, with a Copy code button", () => {
    const root = pass();
    const code = root.querySelector<HTMLElement>('[data-slot="code"]')!;
    expect(code.className.split(" ")).toEqual(expect.arrayContaining(["font-mono", "text-code-lg"]));
    expect(code.textContent).toBe(COMMON.code);
    const groups = [...code.querySelectorAll<HTMLElement>('[data-slot="code-group"]')];
    expect(groups.map((g) => g.textContent)).toEqual(["RIVER-", "MAPLE-", "7Q4K-", "HAWK"]);
    for (const g of groups) expect(g.className).toContain("whitespace-nowrap");
    expect(root.innerHTML).not.toContain("wrap-anywhere");
    expect(within(root).getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  test("bottom: the QR on a light surface-raised tile with alt text, and the precinct and date line", () => {
    pass();
    const tile = screen.getByRole("img", { name: "QR code for tracking code RIVER-MAPLE-7Q4K-HAWK" });
    expect(tile.dataset.theme).toBe("light");
    expect(tile.className.split(" ")).toEqual(expect.arrayContaining(["bg-surface-raised", "rounded-md"]));
    expect(within(tile).getByTestId("qr")).toBeTruthy();
    expect(screen.getByText("Precinct 12 · Nov 3, 2026").className).toContain("text-on-inverse");
  });

  test("footer: the promise in on-inverse-muted, last on the card", () => {
    const root = pass();
    const promise = screen.getByText(RECEIPT_PROMISE);
    expect(promise.className).toContain("text-on-inverse-muted");
    expect(promise.className).toContain("text-body-lg");
    const card = root.querySelector(".vbt-pass")!;
    expect(card.textContent?.endsWith(RECEIPT_PROMISE)).toBe(true);
  });

  test("a decorative perforation: two notches and a dotted on-inverse-muted rule at 30%", () => {
    const perforation = pass().querySelector<HTMLElement>('[data-slot="perforation"]')!;
    expect(perforation.getAttribute("aria-hidden")).toBe("true");
    expect(perforation.innerHTML).toContain("border-dotted");
    expect(perforation.innerHTML).toContain("border-on-inverse-muted/30");
    expect(perforation.querySelectorAll(".rounded-pill")).toHaveLength(2);
  });

  test("actions under the pass, outside the card: Track this ballot, Save image, and that saving is safe", () => {
    const onSaveImage = vi.fn();
    const root = pass({ trackHref: "/track/RIVER-MAPLE-7Q4K-HAWK", onSaveImage });
    const actions = root.querySelector<HTMLElement>('[data-slot="actions"]')!;
    expect(root.querySelector(".vbt-pass")?.contains(actions)).toBe(false);
    const track = within(actions).getByRole("link", { name: "Track this ballot" });
    expect(track.getAttribute("href")).toBe("/track/RIVER-MAPLE-7Q4K-HAWK");
    expect(track.dataset.variant).toBe("primary");
    fireEvent.click(within(actions).getByRole("button", { name: "Save image" }));
    expect(onSaveImage).toHaveBeenCalledTimes(1);
    expect(actions.textContent).toContain("safe");
  });

  test("no actions or badge unless passed; never a time", () => {
    const { container } = render(<Receipt {...COMMON} />);
    expect(container.querySelector('[data-slot="actions"]')).toBeNull();
    expect(container.querySelector('[data-component="status-badge"]')).toBeNull();
    expect(container.textContent).not.toMatch(TIME);
  });
});

describe("Receipt slip", () => {
  test("the mockup's fields, words and order", () => {
    const { container } = render(<Receipt {...SLIP} phoneCode="4821 9937 06" textNumber="1-800-555-0100" />);
    const root = container.querySelector<HTMLElement>('[data-component="receipt"]')!;
    expect(root.dataset.form).toBe("slip");
    const text = root.textContent ?? "";
    const order = [
      "Marion County General Election · Nov 3, 2026",
      "Precinct 12",
      "Your ballot tracking code:",
      COMMON.code,
      "Track it:vote.marion.in.gov/track",
      "Or call:1-800-555-0100",
      "Phone code:4821 9937 06",
      "Text updates:text TRACK + your code to 1-800-555-0100",
      RECEIPT_PROMISE,
    ];
    let at = -1;
    for (const part of order) {
      const next = text.indexOf(part, at + 1);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
    expect(screen.getByRole("img", { name: `QR code for tracking code ${COMMON.code}` })).toBeTruthy();
    expect(text).not.toMatch(TIME);
  });

  test("the phone-code and text rows appear only when passed", () => {
    const { container } = render(<Receipt {...SLIP} />);
    expect(container.textContent).not.toContain("Phone code");
    expect(container.textContent).not.toContain("Text updates");
  });

  test("an election date with a time of day is refused", () => {
    expect(() => render(<Receipt {...SLIP} electionDate="Nov 3, 2026 7:14 AM" />)).toThrow(/no time of day/);
  });
});

test("the props have no field for a name, choices, a time, a sequence number or a machine", () => {
  type ReceiptPassProps = Extract<ReceiptProps, { form?: "pass" }>;
  type Keys = keyof ReceiptPassProps | keyof ReceiptSlipProps;
  type Forbidden = Extract<
    Keys,
    | "name"
    | "voterName"
    | "choices"
    | "selections"
    | "votes"
    | "time"
    | "castAt"
    | "castTime"
    | "timestamp"
    | "occurredAt"
    | "sequence"
    | "machineId"
  >;
  expectTypeOf<Forbidden>().toEqualTypeOf<never>();
  // @ts-expect-error: a receipt has no voter name
  void (<Receipt {...COMMON} voterName="A. Voter" />);
  // @ts-expect-error: a receipt has no choices
  void (<Receipt {...COMMON} choices={["Yes"]} />);
  // @ts-expect-error: a receipt has no time
  void (<Receipt {...COMMON} castAt="7:14 AM" />);
});
