VBT is a modern product that happens to serve elections: it should feel like the best apps people already use, not like a government website. It is also a utility. A voter enters a code and gets an answer; an official runs a batch and confirms it. Every rule below serves that: the answer first, plain words, no decoration. Build on shadcn/ui with these tokens; the eleven components in this system are VBT's own, and everything else (dialog, menu, table, tabs, toast) is standard shadcn restyled with these tokens.

## Principles

- **Answer first.** On the voter tracker, the current status in `display` is the first thing on screen, above any explanation. One task per screen.
- **Say what happens next, and roughly when.** Every stage note ends with the next step: "Counties certify up to about 2 weeks after Election Day."
- **Track the ballot, never the voter.** No screen shows or asks for a name, birth date or the time someone voted. The receipt carries a code, the election, the date and the precinct, nothing more.
- **Never color alone.** Every status is an icon plus a word plus its color. Challenged and discarded always show the reason in a full sentence.
- **Live status, not real time.** Stages change when officials upload a batch. Write "Updated 9:42 PM", never "real-time".

## Content

- Plain language at about a 6th-grade reading level. Short sentences, active voice. Sound like a well-made consumer app, not a form.
- Address the voter as "you" and "your ballot". Officials are "county officials" or "poll workers", never "admins".
- Stage names are fixed, in this order: **Cast and sealed**, **Counted at precinct**, **Election-night results**, **Certified**. Off-path states: **Challenged**, **Discarded**, **Spoiled**. The exact public labels come from the state machine in the playbook's Locked interfaces (owned by T-02, `packages/domain`); if they differ from these, the Locked interfaces win.
- The tracker never collects a phone number, email or sign-up. Text updates (T-18) start when the voter texts `TRACK <code>`; the page only shows how.
- Spanish stage names (proposed; have a native speaker check them before launch): **Emitida y sellada**, **Contada en el precinto**, **Resultados de la noche electoral**, **Certificada**; **Impugnada**, **Descartada**, **Anulada**. Spanish screens use the same layout, components and order; only the strings change, and the language switch keeps the voter on the same ballot.
- Sentence case everywhere except `label` eyebrows, which are uppercase.
- English and Spanish from day one on voter screens; leave room for Spanish strings, which run about a third longer.
- Errors say what happened and what to do: "We couldn't find that code. Check it against your receipt; codes use letters A–Z and numbers 2–9."
- No emoji. No exclamation marks.

## Color

- `surface` for the page, `surface-raised` for cards and the receipt, `surface-sunk` for input wells. `ink` for text, `ink-muted` for dates and hints.
- `brand-orange` is the one accent, used as a fill: the primary button (text in `on-accent`) and brand blocks. One primary button per screen.
- The current stage is the only orange mark in a timeline: `brand-orange` or `accent-mark` for its circle, `accent-text` for its label, `accent-tint` behind its row. Completed stages use `ink` on `stage-done`; upcoming stages are outlined or on `surface-sunk`.
- Status colors (`status-challenged`, `status-discarded`, `status-spoiled` with their `-bg` fills) are semantic, not accents. Verified integrity uses `ink` with a check icon, not green.
- Every interactive element gets a 2px solid `focus` ring at 2px offset.
- `line` is decorative only; any control edge uses `line-strong`.

## Type

- One family for the interface: Instrument Sans, a contemporary grotesque that reads as a modern product rather than a government form. Load it from Google Fonts with weights 400, 500, 600, 700.
- JetBrains Mono for tracking codes and hashes (`code-lg`, `code`), so 0/O and 1/l/I look different. Show codes in groups of four, separated by hyphens.
- Voter mode: `display` for the one status headline, `title`, `body-lg` for all sentences. Never set voter sentences below 18px.
- Admin mode: `heading`, `body`, `small`. Use tabular numbers (`font-variant-numeric: tabular-nums`) for every count and total.

## Layout and modes

| | Voter mode | Admin mode |
| --- | --- | --- |
| Who | Any voter, usually on a phone | Poll workers, county and state officials |
| Density | One idea per screen, `body-lg` | Dense tables, filters, `small` cells |
| Width | Single column, max 560px | Full width, sidebar plus content |
| Key components | CodeEntry, QRScanner, StageTimeline, StatusBadge, IntegrityCheck, Explainer, Receipt | PrecinctTable, BatchActionBar, ChallengeQueue, CrossCheckReport, StatusBadge, StageTimeline (compact) |
| Tone | Calm, reassuring | Precise; every action confirmed |

- Spacing comes only from the scale: `space-4` card padding on phones, `space-6` on desktop, `space-8` between sections.
- `radius-sm` on controls and chips, `radius-md` on cards and dialogs, `radius-lg` on hero cards (tracker card, receipt pass), `radius-pill` on badges, stage circles and the batch bar.
- Separate by elevation and surface, not borders: cards use `shadow-card` on `surface`; floating elements (batch bar, dialogs, the pass) use `shadow-overlay`. Keep `line` for dividers inside a card.
- One dark hero per screen: `surface-inverse` with `on-inverse` text marks the most important object (the tracker card for voters, the batch bar for officials).
- Make the important thing big: the current status headline at 30px, the tracking code as its own chip, counts in tabular numbers.
- Long admin tables page on the server, 50 rows at a time, with a select-all-matching banner for batch actions (see PrecinctTable). Never render every ballot in the browser.
- Light theme ships first. Dark theme tokens exist; ship dark only if time allows.

## Print

- Three things print: the tracker page (a voter keeping a record), the receipt slip, and the cross-check report (officials filing it). One `@media print` block in `packages/ui` covers all three.
- Print is one ink on white: the light theme always, dark heroes become outlined boxes, shadows become thin rules, and badges add a 1px outline so icon, word and outline still carry the status if a printer drops the fill.
- Buttons, pagers, the scanner and anything marked `data-print="hide"` don't print. Content marked `.vbt-print-only` prints but stays hidden on screen, for example the tracker address and the date printed.
- Cards and log rows never split across pages.

## Motion

- Only to confirm a state change: a stage filling in when its batch lands (200ms ease-out). Nothing loops, nothing decorates.
- Respect `prefers-reduced-motion`: switch state with no animation.

## Iconography

- Lucide (shadcn's default set), 20px in voter mode and 16px in admin mode, 1.75 stroke, colored like the text beside it.
- Fixed meanings: lock = Cast and sealed, check = Counted at precinct, bar-chart = Election-night results, badge-check = Certified, flag = Challenged, x-circle = Discarded, rotate-ccw = Spoiled, shield-check = integrity verified.
- No logo exists yet: set "Verifiable Ballot Tracking" in Instrument Sans 700. In production the tracker runs under the county's own name and domain.

## The signature motif

The stage rail (four icon circles on a line, current stage in orange with a halo) appears on the tracker card, the receipt pass and admin rows (as the segmented bar). It is the one recurring brand element; don't invent others.

## Research we follow (rules and wording, never looks)

- **Center for Civic Design, Field Guides to Ensuring Voter Intent:** research-based guidance from EAC and NIST studies. Use it for wording, instructions and the receipt's layout.
- **U.S. Web Design System principles:** take its accessibility rules and plain-language defaults. Don't take its visual style; VBT should look like a modern product.
- **VVSG 2.0 usability and accessibility requirements:** large readable type, high contrast, no reliance on color alone.

## Accessibility floor

- WCAG 2.2 AA: text 4.5:1, large text, icons and control borders 3:1, in both themes. Every color pair in `tokens.json` notes its grounds and meets this.
- Targets at least 44px tall on voter screens.
- Follow VVSG 2.0 usability guidance where it applies to a public website: large readable type, high contrast, no reliance on color alone. VBT is aligned with VVSG 2.0, never "certified".
