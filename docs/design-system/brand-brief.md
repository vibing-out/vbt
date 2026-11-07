# VBT brand brief (draft for the 9:15 design-direction session)

Status: draft from Austin's prep, 2026-11-06. The full draft design system lives at https://claude.ai/artifact/L4tnVcq8gNNjXj8DhYSWdK (tokens, README, six component previews). This file is the short version for the review.

## Direction

VBT should feel like the best modern apps people already use, not like a government website. We are showing elections what a great product experience looks like. It is also a utility: a voter enters a code and gets an answer; an official runs a batch and confirms it.

- **Voter tracker:** the current status is the first thing on screen, above any explanation. One task per screen.
- **Every state says what happens next and roughly when** (for example, "Counties certify up to about 2 weeks after Election Day").
- **Admin:** dense tables, batch actions with a confirmation step, filters that persist.
- **Design the unhappy states too:** loading, code not found, challenged, discarded, offline.
- **Motion only to confirm a state change** (a stage turning complete), 150–250 ms.

## Approach

Proven base, our own identity: shadcn/ui components for behavior and accessibility, restyled entirely by our tokens, plus six VBT components we own (StageTimeline, StatusBadge, CodeEntry, Receipt, IntegrityCheck, BatchActionBar).

Decided 2026-11-06: shadcn/ui, not HeroUI v3 or Geist. HeroUI covers the same standard parts with nicer defaults, but shadcn puts the code in our repo for agents to edit and needs no extra factory setup. Don't mix libraries.

Storyboard of both journeys (10 screens): https://claude.ai/artifact/KjRXemXy7SBcEfk4TzDbFC

## Palette (from the pitch deck, contrast-checked)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `ink` | `#14213D` | `#EEF1F6` | Text |
| `surface` | `#F6F4EE` | `#0F1626` | Page |
| `surface-raised` | `#FFFDF8` | `#17213A` | Cards, receipt |
| `brand-orange` | `#E07A2E` | `#F08A3E` | Primary button fill (navy text) and brand blocks |
| `accent-mark` | `#CC6A22` | `#F08A3E` | Current-stage dot (the deck orange is too light for a small mark: 2.73:1) |
| `accent-text` | `#A84A14` | `#F5A15F` | Orange text |
| `stage-done` | `#C9D3E3` | `#2A3A5C` | Completed stages |

Every text pair meets WCAG AA (4.5:1) and every meaningful mark 3:1, in both themes; checked 2026-11-06.

## Type

- **Instrument Sans** for all interface text: a contemporary grotesque that reads as a modern product. Public Sans was dropped because it is the U.S. government's own typeface.
- **JetBrains Mono** for tracking codes and hashes, so 0/O and 1/l/I look different.
- Libre Baskerville stays in the pitch deck only.

## Signature motif

The stage timeline (four dots on a line, current stage in orange) appears on the receipt, the voter tracker and the admin batch view.

## Inspiration

`design-board.html` (published at https://claude.ai/artifact/G52cMgzizjd2beYVJe6qyy) leads with "Ballot and status tracking": specific designs for the tracker, receipt, stepper, timeline and admin views, plus GitHub Status history, one Sigstore log entry and the ElectionGuard pilot story. No government sites: the references are modern products (Linear, Stripe, Airbnb, Monzo, Granola and others).

## Open choices for 9:15

1. Palette: keep the deck's warm paper and navy, or go cooler and crisper?
2. Typeface: Instrument Sans (recommended) or another modern sans?
3. Dark mode: ship light first, dark only if time allows?
