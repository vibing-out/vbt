// Every foreground/background token pair the components use, with its WCAG minimum.
// contrast.test.ts checks each one in the light and dark themes. A component may only put a color
// on a background if the pair is listed here. Every text pair is held to 4.5:1, whatever its size;
// meaningful non-text marks (dots, rings, icons, control edges, focus rings) to 3:1.
// Every pair here must also appear in tokens.json contrast.pairs at the same minimum or higher
// (contrast.test.ts checks it); pairs the approved docs file lacks are logged in tokens/overrides.ts.

import type { ColorName } from "../tokens";
import { MIN_NON_TEXT, MIN_TEXT } from "./contrast";

export interface ColorPair {
  fg: ColorName;
  bg: ColorName;
  min: typeof MIN_TEXT | typeof MIN_NON_TEXT;
  where: string;
}

const text = (fg: ColorName, bg: ColorName, where: string): ColorPair => ({ fg, bg, min: MIN_TEXT, where });
const mark = (fg: ColorName, bg: ColorName, where: string): ColorPair => ({ fg, bg, min: MIN_NON_TEXT, where });

const SURFACES = ["surface", "surface-raised", "surface-sunk"] as const;
const STATUS = ["challenged", "discarded", "spoiled"] as const;

export const colorPairs: readonly ColorPair[] = [
  // Body and secondary text on every surface (cards, page, wells, hovered and selected table rows).
  ...SURFACES.flatMap((bg) => [text("ink", bg, "body text"), text("ink-muted", bg, "dates, hints, table headers")]),

  // StatusBadge (README Variants): text on fill, and the dot or admin icon on fill. Cast and
  // Counted at precinct text is ink on surface-sunk, listed above.
  mark("ink-muted", "surface-sunk", "Cast badge dot"),
  mark("ink", "surface-sunk", "Counted at precinct badge dot"),
  text("ink", "accent-tint", "Election-night results badge"),
  mark("accent-mark", "accent-tint", "Election-night results badge dot; current timeline dot against its halo"),
  text("ink", "stage-done", "Certified badge, its dot and admin check icon"),
  ...STATUS.map((s) => text(`status-${s}`, `status-${s}-bg`, `${s} badge text, dot and admin icon`)),

  // StageTimeline on a light card.
  text("accent-text", "surface", "current stage label on the page"),
  text("accent-text", "surface-raised", "current stage label"),
  mark("ink", "surface-raised", "done stage dot"),
  mark("surface-raised", "ink", "check cut out of a done dot"),
  mark("accent-mark", "surface-raised", "current stage dot"),
  mark("line-strong", "surface-raised", "upcoming stage ring"),
  mark("surface-raised", "status-challenged", "flag cut out of the Under review dot"),
  mark("surface-raised", "status-discarded", "x cut out of the Not counted node"),

  // Dark heroes: the timeline on the hero card, the receipt pass, the scanner.
  text("on-inverse", "surface-inverse", "hero, receipt pass and scanner text"),
  mark("on-inverse", "surface-inverse", "done and exception dots on the hero, scanner corner brackets"),
  text("surface-inverse", "on-inverse", "icons cut out of on-inverse dots on the hero"),
  text("on-inverse-muted", "surface-inverse", "secondary text, dates and the promise line on dark heroes"),
  mark("on-inverse-muted", "surface-inverse", "upcoming ring on the hero, Copy code button edge"),
  // The approved pairs hold brand-orange on surface-inverse to 4.5:1: it is also the current-stage label there.
  text("brand-orange", "surface-inverse", "current stage dot and label on the hero, scanner brackets on a read"),

  // Status text and marks off their fill: the Under review and Not counted timeline labels and
  // dots on light cards, wells and table rows.
  ...SURFACES.flatMap((bg) => STATUS.map((s) => text(`status-${s}`, bg, `${s} text`))),

  // Buttons and inputs.
  text("on-accent", "brand-orange", "primary button"),
  ...SURFACES.flatMap((bg) => [
    mark("line-strong", bg, "input and secondary button edge"),
    mark("focus", bg, "focus ring"),
    mark("status-discarded", bg, "invalid input ring"),
  ]),
  mark("focus-inverse", "surface-inverse", "focus ring on dark heroes, the receipt pass and the scanner"),
];

export interface DecorativePair {
  fg: string;
  bg: ColorName;
  why: string;
}

/**
 * Colors drawn next to each other that carry no meaning, so WCAG sets no minimum. Each is
 * decorative by its README; the meaning sits in a listed pair beside it.
 */
export const decorativePairs: readonly DecorativePair[] = [
  { fg: "stage-done", bg: "surface-raised", why: "Timeline track fill. tokens.json: decorative, dots and labels carry the state." },
  { fg: "line", bg: "surface-raised", why: "Timeline track not yet reached. tokens.json: line is decorative only." },
  { fg: "on-inverse-muted/30", bg: "surface-inverse", why: "Hero timeline track not yet reached; receipt perforation rule (README: decorative only)." },
  { fg: "accent-tint", bg: "surface-raised", why: "Current dot halo; the accent-mark dot carries the state." },
  { fg: "brand-orange/30", bg: "surface-inverse", why: "Current dot halo on the hero; the dot against the halo is checked in contrast.test.ts." },
  { fg: "surface-sunk", bg: "surface-raised", why: "Loading skeleton bars; the list is aria-busy and each item reads as loading." },
  { fg: "surface", bg: "surface-inverse", why: "Receipt perforation notches (README: decorative only)." },
];
