# CodeEntry

The voter home screen's one card: type the tracking code or scan the receipt's QR code.

- **Consumer provides:** the submit handler, the scan handler, and after a failed lookup the error message.
- A `.vbt-card` at `radius-md` with a 24px title, one line of help ("No account needed."), a 64px mono field on `surface-sunk`, a full-width orange "Track my ballot" button, an "or" divider, and a secondary "Scan the QR code" button.
- The field has no border at rest; focus shows a 2px `focus` ring with an `accent-tint` halo.
- Accept lower case, spaces and missing hyphens; normalize to hyphenated groups as the voter types.
- Not found: keep the input, ring it in `status-discarded`, set `aria-invalid`, and show a soft red message with a bold summary and what to check. Never say the ballot doesn't exist.
- No account, no sign-in, no name or birth date. The QR code opens the tracker directly.
