// Deliberate differences between packages/ui/src/tokens/tokens.json and the approved
// docs/design-system/design-system/tokens.json. The drift test applies these to the docs file and
// expects the result to equal the package copy, so any other edit to the copy fails CI.
//
// Every override needs a reason and the text of the context-log decision that records it.

export interface TokenOverride {
  /**
   * JSON Pointer into tokens.json, e.g. "/color/tokens/3/value/light". A final "-" appends to an
   * array (RFC 6901), e.g. "/contrast/pairs/-".
   */
  pointer: string;
  /** The value the package copy holds at that pointer. */
  value: unknown;
  /** Why the approved value had to change (for example, a contrast pair that failed). */
  reason: string;
  /** The context-log decision recording the change. */
  decision: string;
}

const LOGGED_PAIRS_DECISION =
  "T-03: packages/ui adds five component color pairs that the approved docs tokens.json contrast.pairs does not list (ink-muted on accent-tint, surface-inverse on on-inverse, and status-challenged, status-discarded and status-spoiled on surface-sunk) to its tokens.json copy as logged overrides, each held to 4.5:1 and passing in both themes; no token value changes.";

export const overrides: readonly TokenOverride[] = [
  {
    pointer: "/contrast/pairs/-",
    value: { fg: "ink-muted", bg: "accent-tint", min: 4.5 },
    reason: "Used by the date in the current StageTimeline history row; not in the approved contrast.pairs. Measured 6.37:1 light, 6.90:1 dark.",
    decision: LOGGED_PAIRS_DECISION,
  },
  {
    pointer: "/contrast/pairs/-",
    value: { fg: "surface-inverse", bg: "on-inverse", min: 4.5 },
    reason: "Used by the icon in a done rail circle on the dark hero, and the QR tile on the receipt pass; not in the approved contrast.pairs. Measured 14.52:1 light, 11.57:1 dark.",
    decision: LOGGED_PAIRS_DECISION,
  },
  {
    pointer: "/contrast/pairs/-",
    value: { fg: "status-challenged", bg: "surface-sunk", min: 4.5 },
    reason: "Used by Challenged status text inside wells (table header rows, input wells); not in the approved contrast.pairs. Measured 4.89:1 light, 11.36:1 dark.",
    decision: LOGGED_PAIRS_DECISION,
  },
  {
    pointer: "/contrast/pairs/-",
    value: { fg: "status-discarded", bg: "surface-sunk", min: 4.5 },
    reason: "Used by Discarded status text and the input error message and invalid ring on an input well; not in the approved contrast.pairs. Measured 6.24:1 light, 7.86:1 dark.",
    decision: LOGGED_PAIRS_DECISION,
  },
  {
    pointer: "/contrast/pairs/-",
    value: { fg: "status-spoiled", bg: "surface-sunk", min: 4.5 },
    reason: "Used by Spoiled status text inside wells; not in the approved contrast.pairs. Measured 4.77:1 light, 9.06:1 dark.",
    decision: LOGGED_PAIRS_DECISION,
  },
];
