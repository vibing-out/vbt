import { render, screen } from "@testing-library/react";
import { describe, expect, expectTypeOf, test } from "vitest";
import { Receipt, RECEIPT_PROMISE, type ReceiptProps, type ReceiptSlipProps } from "./receipt";

const COMMON = {
  county: "Marion County",
  election: "General Election",
  electionDate: "Nov 3, 2026",
  precinct: "Precinct 12",
  code: "RIVER-MAPLE-7Q4K-HAWK",
  qr: <div data-testid="qr">QR</div>,
};

const SLIP: ReceiptSlipProps = {
  ...COMMON,
  form: "slip",
  trackUrl: "vote.marion.in.gov/track",
  phone: "1-800-555-0100",
};

const TIME = /\d{1,2}:\d{2}/;

test("the promise line is fixed", () => {
  expect(RECEIPT_PROMISE).toBe("Shows your ballot's progress. Does not show how you voted.");
});

describe("Receipt pass", () => {
  test("renders county, title, mono code, election, date, precinct, QR and the promise", () => {
    const { container } = render(<Receipt {...COMMON} />);
    const root = container.querySelector<HTMLElement>('[data-component="receipt"]')!;
    expect(root.dataset.form).toBe("pass");
    expect(root.className).toContain("bg-surface-inverse");
    expect(root.className).toContain("rounded-lg");
    for (const text of ["Marion County", "Ballot receipt", "General Election", "Nov 3, 2026", "Precinct 12"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText(COMMON.code).className).toContain("font-mono");
    expect(screen.getByTestId("qr")).toBeTruthy();
    expect(screen.getByText(RECEIPT_PROMISE)).toBeTruthy();
    expect(root.textContent).not.toMatch(TIME);
  });
});

describe("Receipt slip", () => {
  test("renders county, election, precinct, code, QR, address, phone and the promise", () => {
    const { container } = render(<Receipt {...SLIP} />);
    const root = container.querySelector<HTMLElement>('[data-component="receipt"]')!;
    expect(root.dataset.form).toBe("slip");
    const text = root.textContent ?? "";
    for (const part of [
      "Marion County",
      "General Election",
      "Precinct 12",
      COMMON.code,
      "vote.marion.in.gov/track",
      "1-800-555-0100",
      RECEIPT_PROMISE,
    ]) {
      expect(text).toContain(part);
    }
    expect(screen.getByTestId("qr")).toBeTruthy();
    expect(screen.getByText(COMMON.code).className).toContain("font-mono");
    expect(text).not.toMatch(TIME);
  });

  test("the phone-code and text rows appear only when passed", () => {
    const { container, rerender } = render(<Receipt {...SLIP} />);
    expect(container.textContent).not.toContain("Phone code");
    expect(container.textContent).not.toContain("Text updates");
    rerender(<Receipt {...SLIP} phoneCode="7482-6619-0354-2817" textNumber="1-800-555-0100" />);
    expect(container.textContent).toContain("Phone code:7482-6619-0354-2817");
    expect(container.textContent).toContain("Text updates");
  });

  test("an election date with a time of day is refused", () => {
    expect(() => render(<Receipt {...SLIP} electionDate="Nov 3, 2026 7:14 AM" />)).toThrow(/no time of day/);
  });
});

test("the props have no field for a name, choices or a time", () => {
  type Keys = keyof ReceiptPassProps | keyof ReceiptSlipProps;
  type ReceiptPassProps = Extract<ReceiptProps, { form?: "pass" }>;
  type Forbidden = Extract<
    Keys,
    "name" | "voterName" | "choices" | "selections" | "votes" | "time" | "castAt" | "castTime" | "timestamp" | "occurredAt"
  >;
  expectTypeOf<Forbidden>().toEqualTypeOf<never>();
  // @ts-expect-error: a receipt has no voter name
  void (<Receipt {...COMMON} voterName="A. Voter" />);
  // @ts-expect-error: a receipt has no choices
  void (<Receipt {...COMMON} choices={["Yes"]} />);
  // @ts-expect-error: a receipt has no time
  void (<Receipt {...COMMON} castAt="7:14 AM" />);
});
