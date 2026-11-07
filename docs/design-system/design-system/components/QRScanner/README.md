# QRScanner

A camera view that reads the QR code on a receipt and opens that ballot's tracking page.

**Mode:** voter (poll workers may also use it to spot-check a slip).

## When to use

Only after the voter chooses "Scan the QR code instead" from CodeEntry. Most voters scan with their phone's own camera, which opens the tracking URL directly; this is the in-page fallback.

## Anatomy

1. Full-bleed camera preview on `surface-inverse` with `radius-lg` corners on wider screens.
2. A square viewfinder: four corner brackets in `on-inverse`, 3px, `radius-sm` corners. A soft dim (`surface-inverse` at 60%) outside the square.
3. Instruction under the viewfinder in `on-inverse`: "Point at the QR code on your slip."
4. Close button (top right, `x` icon, accessible name "Close scanner").
5. Fallback link: "Type the code instead".

## Behavior

- Ask for camera permission only after the voter taps scan, with a line explaining why: "We use the camera only to read the code. Nothing is recorded."
- Decode on the device. No frames leave the phone.
- Accept only URLs on the tracker's own domain or a bare code; anything else shows "That QR code isn't a VBT receipt."
- On a valid read: a short vibration where supported, the corners turn `brand-orange` for `duration-fast`, then navigate.
- Stop the camera as soon as the scanner closes or navigates.

## States

| State | Treatment |
| --- | --- |
| Asking permission | Explanation plus "Allow camera" primary button |
| Permission denied | "Camera access is off. You can type the code instead." with the CodeEntry link as the primary action |
| No camera | Go straight to CodeEntry with a one-line note |
| Scanning | Viewfinder, no spinner |
| Wrong code | Message above the viewfinder in `on-inverse`, scanning continues |

## Accessibility

- The scanner is never the only path; CodeEntry is always one tap away.
- Focus moves to the close button on open and returns to the trigger on close; Escape closes.
- Status changes ("Code found, opening your ballot") go to a polite live region.
- `focus-inverse` rings on the dark surface.

## Acceptance checks

- [ ] Works with permission denied (falls back cleanly).
- [ ] Rejects a QR code for another domain.
- [ ] Camera indicator turns off after closing.
- [ ] Fully usable by keyboard without ever using the camera.
