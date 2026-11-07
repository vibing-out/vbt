"use client";

import { QrFrame } from "@vbt/ui/components/qr-frame";
import type { Mode } from "@vbt/ui/lib/mode";
import { useState } from "react";

/** The scanner frame with sample states. No camera: "Type the code instead" switches to the found state. */
export function QrDemo({ mode, code }: { mode: Mode; code: string }) {
  const [found, setFound] = useState(false);
  return (
    <QrFrame
      mode={mode}
      state={found ? "found" : "scanning"}
      code={code}
      onManualEntry={() => setFound((f) => !f)}
    />
  );
}
