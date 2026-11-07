# VBT design system (reference)

The approved design decisions for VBT: principles, wording, color, type, voter and admin modes, motion, icons and the accessibility floor. They were planned before kickoff as design notes; this folder holds only those decisions and the token values, not code. `packages/ui` (T-03) is where they get built.

| Path | What it is |
| --- | --- |
| `brand-brief.md` | The product feel and the references we follow |
| `design-system/README.md` | The rules: principles, content, color, type, layout and modes, print, motion, icons, accessibility |
| `design-system/tokens.json` | Token values (color, type, spacing, radius, elevation), the source of truth for `packages/ui` |
| `design-system/components/<Name>/README.md` | Guidelines for each VBT component |
| `storyboard/README.md` | The planned journey screens |

Components: StageTimeline, StatusBadge, CodeEntry, QRScanner, Receipt, IntegrityCheck, Explainer (voter); PrecinctTable, BatchActionBar, ChallengeQueue, CrossCheckReport (admin).

Base: shadcn/ui with our own tokens; fonts Instrument Sans and JetBrains Mono.
