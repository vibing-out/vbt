# VBT design system

Rules for every VBT screen. Values live in [`tokens.json`](tokens.json); per-component behavior lives in [`components/`](components/). The implementation is `packages/ui` in `vibing-out/vbt`, built on shadcn/ui and themed only through these tokens.

## 1. Principles

1. **Status first.** The first thing on any voter screen is the answer, in one sentence. Detail and proof come after.
2. **One task per screen for voters.** Enter a code, read a status, check the proof. Never two of those competing on one screen.
3. **Density for officials.** Admin screens show many rows at once, sorted and filtered, with actions on selections.
4. **Nothing irreversible by accident.** Every batch action and every resolution confirms with the exact count and scope before it runs.
5. **Proof is one tap away.** Every stage can show its evidence. It is never the default view.
6. **Never leak order or identity.** Show dates, never times or sequence numbers, anywhere a tracking code appears. No names, ever.
7. **Color is never alone.** Every status has a word and an icon; every state survives grayscale.

## 2. Content and wording

### Status vocabulary

These public labels come from the locked state machine. Use them exactly; don't invent synonyms.

| Status | Badge label | Headline (voter) | Next step line |
| --- | --- | --- | --- |
| `CAST` | Cast | Your ballot is cast and sealed | It's counted at your precinct after polls close. |
| `TALLIED_PRECINCT` | Counted at precinct | Your ballot was counted at Precinct 12 | Your county reports election-night results next. |
| `REPORTED_UNOFFICIAL` | Election-night results | Your ballot is in Marion County's election-night results | Certification is usually within two weeks. |
| `CERTIFIED` | Certified | Your ballot is in the certified results | Nothing more to do. This is final. |
| `CHALLENGED` | Under review | Your ballot is under review | Give the reason, who is reviewing it, and that most reviews end with the ballot counted. |
| `DISCARDED` | Not counted | Your ballot was not counted | Give the recorded reason and who to contact. |
| `SPOILED` | Spoiled | This ballot was spoiled to check the machine | Your replacement ballot has its own code. |

### Rules

- Sentence case everywhere except the uppercase `label` style.
- Name the place and date: "on Nov 3", "at Precinct 12", "Marion County". Never a time of day next to a tracking code.
- Buttons are verbs with objects: "Check ballot", "Mark 412 as counted", "Resolve as accepted". Never "Submit" or "OK".
- Errors say what happened and what to do: "We couldn't find that code. Check the letters against your slip; codes have four parts."
- Don't say "vote" when you mean "ballot". The system tracks ballots and never knows votes.
- Don't claim safety; state what was verified: "Your encrypted ballot is unchanged since it was cast."
- Numbers: digits always, with thousands separators ("1,204 ballots").
- Dates: "Nov 3, 2026" in full, "Nov 3" when the year is obvious.

## 3. Color

All colors come from `tokens.json`; components never use raw hex.

- **Surfaces.** `surface` is the page. `surface-raised` is every card. `surface-sunk` is wells and inputs. `surface-inverse` is the dark navy used for the tracker hero card, the receipt pass and the batch pill, and at most one such surface per screen.
- **Text.** `ink` for primary, `ink-muted` for secondary. On `surface-inverse`, `on-inverse` and `on-inverse-muted`.
- **Orange has three roles, never mixed.** `brand-orange` is a fill (primary button, brand areas) with `on-accent` navy text, and on `surface-inverse` only it may also be the current-stage mark and label. `accent-mark` is a small meaningful mark (the current stage dot). `accent-text` is orange text. Light-mode `brand-orange` fails as text and as a small mark, which is why the other two exist.
- **Status colors** come in pairs: `status-*` for text, dot and icon; `status-*-bg` for the badge or callout fill. Only exceptional states (challenged, discarded, spoiled) get status colors. Normal progress uses ink and the orange current-stage mark.
- **Lines.** `line` is decorative only. `line-strong` is any edge that defines a control.
- **Contrast.** Every pair a component uses must be listed under `contrast.pairs` and pass `node scripts/check-contrast.mjs`. Add the pair before using it.
- **Dark mode** is supported by the same token names. Voter screens follow the system setting.

## 4. Type

Two families: Instrument Sans (`sans`) for all text, JetBrains Mono (`mono`) for codes and hashes. Load both from Google Fonts with `font-display: swap`; weights 400, 500, 600, 700 for sans, 400 and 500 for mono.

| Mode | Styles | Rule |
| --- | --- | --- |
| Voter | `display`, `title`, `body-lg`, `label` | Sentences are never smaller than `body-lg` (18px). |
| Admin | `heading`, `body`, `small` | `small` (14px) is for table cells and metadata only. |
| Codes | `code-lg`, `code` | A tracking code alone uses `code-lg`; inside tables, `code`. |

- One `display` headline per voter screen: the status.
- Line length 45 to 75 characters for voter body text.
- Tabular numbers (`font-variant-numeric: tabular-nums`) in every table and count.
- Tracking codes render in four groups separated by hyphens and never wrap mid-group.
- Text must reflow at 200% zoom with no loss and no horizontal scroll at 320px wide.

## 5. Layout and modes

### Spacing and shape

Use only the `space-*` steps. Cards use `radius-md` and `shadow-card` with no border; hero surfaces use `radius-lg`; badges and dots use `radius-pill`. Elevation separates cards from the page, not outlines. `shadow-overlay` is for anything that floats.

### Voter mode

- Single column, max 560px content width, centered; `space-4` gutters on phones.
- Order on the tracker: status headline, hero card with the StageTimeline, the next-step line, IntegrityCheck, Explainer. Nothing above the headline but the minimal header.
- One primary action per screen, full width on phones, at least 48px tall.
- No navigation menus. A back link and the header logo are enough.
- Works fully without an account, without JavaScript-heavy interactions, on a five-year-old phone over 3G.

### Admin mode

- Fixed left rail for sections (Precincts, Challenges, Cross-checks), content area up to 1440px.
- Tables are the primary surface: 44px rows, sticky header, sortable columns, row checkboxes.
- Filters sit above the table as chips and **persist** in the URL query string, so reloads, back and shared links keep them.
- Selecting rows raises the BatchActionBar pill; every batch action confirms in a dialog with the exact count and scope.
- Every destructive or final action (discard, certify) requires a typed or selected reason and shows who will be recorded as the actor.
- Admin screens need sign-in with multi-factor authentication; voter screens never ask for anything.

### Breakpoints

| Name | Width | Notes |
| --- | --- | --- |
| phone | under 640px | Voter default. Admin shows a "use a larger screen" note for batch actions but stays readable. |
| tablet | 640 to 1023px | Admin rail collapses to icons with labels on hover and focus. |
| desktop | 1024px and up | Full admin layout. |

## 6. Print

The paper receipt is printed at the polling place, so it must work on a thermal or laser printer in black only.

- Black on white, no tints, no shadows, no orange. Paper color is set by the slip stock, not by ink.
- Tracking code in JetBrains Mono at 14pt or larger, the QR code at least 25mm square with a 4-module quiet zone.
- Contents and order follow the receipt mockup in `vibing-out/vbt` `docs/voter-journey.md`. Never print choices, time of voting or name.
- A print stylesheet for the web receipt view hides navigation and the wallet styling and prints the plain slip.

## 7. Motion

Motion confirms change; it never decorates.

- Use the `duration-*` and `ease-out` tokens.
- Allowed: hover and press feedback, a status badge cross-fading to a new status, the timeline line filling to a newly reached stage, the batch pill sliding up when rows are selected, drawers and dialogs.
- Not allowed: looping animation, parallax, confetti, animated numbers in tables.
- Under `prefers-reduced-motion: reduce`, replace every movement with an instant change or a fade no longer than `duration-fast`.
- Live updates (a ballot advancing while the page is open) animate once and are announced politely to screen readers.

## 8. Icons

- Lucide, the icon set shadcn/ui uses, at 1.5px stroke. 20px in voter mode, 16px in admin tables.
- An icon is never the only label on an action except universally understood ones (close, search) and those still carry an accessible name.
- Fixed meanings, never reused for anything else:

| Meaning | Lucide icon |
| --- | --- |
| Completed stage, check passed | `check` |
| Challenged | `flag` |
| Discarded, check failed | `x` |
| Spoiled | `undo-2` |
| Proof and integrity | `shield-check` |
| Download record | `download` |
| Scan | `scan-line` |

## 9. Accessibility

WCAG 2.2 AA is the floor. Each component spec lists its own checks; these apply everywhere.

- **Contrast.** Text 4.5:1, control edges and meaningful marks 3:1, verified by `node scripts/check-contrast.mjs`.
- **Focus.** A visible 2px `focus` ring at 2px offset on every interactive element; `focus-inverse` on dark navy surfaces. The offset means the ring is measured against the page, not the control fill. Never remove outlines without this replacement.
- **Targets.** At least 44 by 44px in voter mode, at least 24 by 24px in admin tables.
- **Keyboard.** Everything works by keyboard in a logical order; dialogs trap focus and return it on close; Escape closes overlays.
- **Screen readers.** Landmarks on every page, one `h1` per page (the status headline on the tracker), real tables with headers for admin data, live regions for status changes.
- **Not color alone.** Every status has a word and an icon; the current stage is also marked with `aria-current="step"` and the word "Now".
- **Zoom and reflow.** 200% zoom and 320px width with no horizontal scroll and no clipped text.
- **Language.** Plain language at about a sixth-grade reading level on voter screens; `lang` set on the document.
- **Time.** No timeouts on voter screens. Admin sessions warn before expiring and keep unsaved filters.
