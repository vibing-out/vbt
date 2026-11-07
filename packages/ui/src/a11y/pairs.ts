// Every foreground/background token pair the components use, with its WCAG minimum.
// contrast.test.ts checks each one in the light and dark themes. A component may only put a color
// on a background if the pair is listed here. Every text pair is held to 4.5:1, whatever its size.

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

export const colorPairs: readonly ColorPair[] = [
  // Body text and secondary text on every surface.
  ...SURFACES.flatMap((bg) => [text("ink", bg, "body text"), text("ink-muted", bg, "dates, hints, table headers")]),
  text("ink", "stage-done", "done stage badge, done history circle"),
  text("ink-muted", "stage-done", "date on a done stage"),
  text("ink", "accent-tint", "selected table row, current history row note"),
  text("ink-muted", "accent-tint", "date in the current history row"),

  // Orange text.
  text("accent-text", "surface", "current stage label"),
  text("accent-text", "surface-raised", "current stage label in a card"),
  text("accent-text", "accent-tint", "current badge, current history row label"),

  // Fills.
  text("on-accent", "brand-orange", "primary button, current rail circle icon"),
  text("on-inverse", "surface-inverse", "hero card, receipt pass, scanner panel"),
  text("on-inverse-muted", "surface-inverse", "eyebrows and facts on dark heroes"),
  text("surface-inverse", "on-inverse", "done rail circle icon, QR tile"),

  // Status colors on their fill and on plain surfaces.
  text("status-challenged", "status-challenged-bg", "challenged badge"),
  text("status-discarded", "status-discarded-bg", "discarded badge"),
  text("status-spoiled", "status-spoiled-bg", "spoiled badge"),
  ...SURFACES.flatMap((bg) => [
    text("status-challenged", bg, "challenged text"),
    text("status-discarded", bg, "discarded text, input error message"),
    text("status-spoiled", bg, "spoiled text"),
  ]),

  // Non-text marks: control borders, the current-stage mark, the focus ring.
  ...SURFACES.flatMap((bg) => [
    mark("line-strong", bg, "input and secondary button border, upcoming circle ring"),
    mark("accent-mark", bg, "current segment in the compact bar"),
    mark("focus", bg, "focus ring"),
    mark("status-discarded", bg, "invalid input ring"),
    mark("ink", bg, "done segment in the compact bar"),
  ]),
  mark("on-inverse", "surface-inverse", "focus ring and done rail circle on dark heroes"),
  mark("on-inverse-muted", "surface-inverse", "upcoming rail circle ring, tear line"),
  mark("brand-orange", "surface-inverse", "current rail circle, scanner corner brackets"),
];
