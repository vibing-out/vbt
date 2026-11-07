# QRScanner

The camera view a voter sees after tapping "Scan the QR code"; the receipt's QR opens their tracker directly.

- **Consumer provides:** the camera stream, the decode handler, and the manual-entry handler.
- `surface-inverse` panel at `radius-lg`, a 220px viewfinder with four `brand-orange` corner brackets, one line of help, and a "Type the code instead" fallback that opens CodeEntry.
- Ask for camera permission only when the voter taps scan, and say why in one line. If permission is denied, go straight to CodeEntry with no error tone.
- On a successful read, show "Receipt found" with the code in mono before opening the tracker, so the voter can confirm it's theirs.
- Never store or upload camera frames; decode on the device.
