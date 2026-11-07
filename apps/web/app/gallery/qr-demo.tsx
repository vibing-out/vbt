"use client";

import { QrFrame, type QrFrameState } from "@vbt/ui/components/qr-frame";
import type { Mode } from "@vbt/ui/lib/mode";
import { useState } from "react";

const STATES: QrFrameState[] = ["scanning", "found", "wrong-code"];

/** The scanner frame with sample states. No camera: "Type the code instead" steps through the states. */
export function QrDemo({ mode }: { mode: Mode }) {
  const [state, setState] = useState(0);
  return (
    <QrFrame
      mode={mode}
      state={STATES[state]}
      focusOnOpen={false}
      onManualEntry={() => setState((s) => (s + 1) % STATES.length)}
    />
  );
}
