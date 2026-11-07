# CodeEntry

The field where a voter types the tracking code from their slip.

**Mode:** voter.

## When to use

On the track page when the voter arrives without a code in the URL (they typed the printed address instead of scanning the QR code). It is the only task on that screen.

## Code format

Four hyphen-separated groups, for example `RIVER-MAPLE-7Q4K-HAWK`. The exact alphabet comes from `packages/crypto`; this component accepts what that package validates and never invents its own rule.

## Anatomy

1. `title`: "Check your ballot".
2. `body-lg` hint: "Type the code printed on your slip."
3. Label (`label` style): "TRACKING CODE".
4. One text input on `surface-sunk`, `radius-sm`, 2px `line-strong` edge, 56px tall, `code-lg` text, uppercase display.
5. Primary button, full width: "Check ballot".
6. Secondary link: "Scan the QR code instead" (opens QRScanner).
7. Footnote in `ink-muted`: "Lost your slip? Codes can't be recovered. That's what keeps your vote private."

## Behavior

- **One field, not four boxes.** Separate boxes break paste, autofill and screen readers.
- Accept any case, spaces or no hyphens; normalize to uppercase with hyphens as the voter types, without moving the caret unexpectedly.
- Paste of a full code or a full tracking URL works; extract the code from the URL.
- Validate on submit, not on every keystroke. Common misreads (0 and O, 1 and I) are corrected if the alphabet makes it unambiguous.
- `autocomplete="off"`, `autocapitalize="characters"`, `spellcheck="false"`, `inputmode="text"`.
- On success, navigate to `/track/<code>`; the code goes in the path, never stored.

## States

| State | Treatment |
| --- | --- |
| Empty | Placeholder in `ink-muted`: `XXXXX-XXXXX-XXXX-XXXX` pattern |
| Focused | `focus` ring at 2px offset |
| Checking | Button shows "Checking..." and is disabled; field stays editable |
| Malformed | `status-discarded` text below: "That doesn't look like a full code. Codes have four parts, like RIVER-MAPLE-7Q4K-HAWK." |
| Not found | "We couldn't find that code. Check each letter against your slip." Plus a reminder that new ballots appear within a few minutes of casting. |
| Rate limited | "Too many tries. Wait a minute and try again." |

## Accessibility

- Visible label tied with `for`/`id`; hint and error tied with `aria-describedby`.
- Errors announced with `role="alert"` and the field gets `aria-invalid="true"`.
- Focus moves to the field on load only when it's the only task on the page.
- Target size 48px tall minimum.

## Acceptance checks

- [ ] Pasting `river maple 7q4k hawk` yields `RIVER-MAPLE-7Q4K-HAWK`.
- [ ] Pasting a full tracking URL extracts the code.
- [ ] Every error state reads aloud and says what to do.
- [ ] The code never appears in analytics, logs or local storage.
