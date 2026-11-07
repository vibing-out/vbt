// Deliberate differences between packages/ui/src/tokens/tokens.json and the approved
// docs/design-system/design-system/tokens.json. The drift test applies these to the docs file and
// expects the result to equal the package copy, so any other edit to the copy fails CI.
//
// Every override needs a reason and the text of the context-log decision that records it.

export interface TokenOverride {
  /** JSON Pointer into tokens.json, e.g. "/color/tokens/3/value/light". */
  pointer: string;
  /** The value the package copy holds at that pointer. */
  value: unknown;
  /** Why the approved value had to change (for example, a contrast pair that failed). */
  reason: string;
  /** The context-log decision recording the change. */
  decision: string;
}

export const overrides: readonly TokenOverride[] = [];
