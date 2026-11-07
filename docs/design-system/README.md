# VBT design system

The design reference for Verifiable Ballot Tracking (VBT), written on kickoff day of Indy Init 2026. It tells the people and agents building `vibing-out/vbt` how the product should look, read and behave.

This repo holds specifications only. The one implementation is `packages/ui` in `vibing-out/vbt`; nothing here is imported or built.

## What's here

| Path | What it is |
| --- | --- |
| [`brand-brief.md`](brand-brief.md) | Who VBT is for, how it should feel, and what it must never feel like |
| [`design-system/README.md`](design-system/README.md) | Principles, wording, color, type, layout and the two modes, print, motion, icons, accessibility |
| [`design-system/tokens.json`](design-system/tokens.json) | Every token with its value and usage, plus the color pairs that must pass contrast |
| [`design-system/components/`](design-system/components/) | One spec per component: purpose, anatomy, states, wording, accessibility, acceptance checks |
| [`scripts/check-contrast.mjs`](scripts/check-contrast.mjs) | Checks every declared color pair against WCAG 2.2 AA in both themes |

## Components

Voter mode: [StageTimeline](design-system/components/StageTimeline/README.md), [StatusBadge](design-system/components/StatusBadge/README.md), [CodeEntry](design-system/components/CodeEntry/README.md), [QRScanner](design-system/components/QRScanner/README.md), [Receipt](design-system/components/Receipt/README.md), [IntegrityCheck](design-system/components/IntegrityCheck/README.md), [Explainer](design-system/components/Explainer/README.md).

Admin mode: [PrecinctTable](design-system/components/PrecinctTable/README.md), [BatchActionBar](design-system/components/BatchActionBar/README.md), [ChallengeQueue](design-system/components/ChallengeQueue/README.md), [CrossCheckReport](design-system/components/CrossCheckReport/README.md).

## Using it

1. Read the brand brief, then the system README.
2. Map `tokens.json` to CSS variables in `packages/ui` with the same names (`--surface`, `--ink`, `--space-4`, ...). Map them onto shadcn/ui's variables rather than editing shadcn's components.
3. Build each component to its spec. Each spec ends with acceptance checks a reviewer can run.

## Changing it

- Token names are a contract with `packages/ui`. Add tokens freely; rename or remove one only with a matching `packages/ui` change.
- After any color change, run the contrast check and fix every failure before merging:

  ```bash
  node scripts/check-contrast.mjs
  ```

- `vibing-out/vbt` keeps a copy in `docs/design-system/`. Update both in the same hour.
