// @vitest-environment jsdom
import { TRACKING_CODE_PATTERN } from "@vbt/crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReceiptScanner } from "./receipt-scanner";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderScanner() {
  render(
    <>
      <input id="code" aria-label="Tracking code" />
      <ReceiptScanner hosts={["www.ballottrack.org"]} codePattern={TRACKING_CODE_PATTERN.source} manualInputId="code" />
    </>,
  );
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
}

afterEach(() => setMediaDevices(undefined));

describe("ReceiptScanner without camera access", () => {
  test("renders the scan button and never touches the camera until asked", () => {
    const getUserMedia = vi.fn();
    setMediaDevices({ getUserMedia });
    renderScanner();
    expect(screen.getByRole("button", { name: "Scan your receipt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan your receipt" }));
    expect(screen.getByText(/only to read the code\. Nothing is recorded/)).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  test("with no camera API, says so and keeps the typed-code path one tap away", async () => {
    renderScanner();
    fireEvent.click(screen.getByRole("button", { name: "Scan your receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow camera" }));
    expect((await screen.findByTestId("scanner-unavailable")).textContent).toContain("No camera is available");
    fireEvent.click(screen.getByRole("button", { name: "Type the code instead" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Tracking code"));
  });

  test("when permission is denied, shows the camera-off message", async () => {
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) });
    renderScanner();
    fireEvent.click(screen.getByRole("button", { name: "Scan your receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow camera" }));
    expect((await screen.findByTestId("scanner-unavailable")).textContent).toContain(
      "Camera access is off. You can type the code instead.",
    );
    expect(screen.getByLabelText("Tracking code")).toBeTruthy();
  });
});
