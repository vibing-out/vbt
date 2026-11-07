"use client";

import type { ReactNode } from "react";
import { bodyText, iconSize, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";

export interface QrFrameLabels {
  help: string;
  manualEntry: string;
  found: string;
}

export const QR_FRAME_LABELS: QrFrameLabels = {
  help: "Point your camera at the QR code on your receipt.",
  manualEntry: "Type the code instead",
  found: "Receipt found",
};

export interface QrFrameProps {
  mode?: Mode;
  /** The camera view, provided by the consumer. This frame never touches the camera or decodes. */
  children?: ReactNode;
  /** Opens CodeEntry. */
  onManualEntry?: () => void;
  state?: "scanning" | "found";
  /** The decoded code, shown in mono when state is "found" so the voter can confirm it's theirs. */
  code?: string;
  labels?: Partial<QrFrameLabels>;
  className?: string;
}

const CORNERS = [
  ["top-left", "top-0 left-0 border-t-4 border-l-4 rounded-tl-md"],
  ["top-right", "top-0 right-0 border-t-4 border-r-4 rounded-tr-md"],
  ["bottom-left", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-md"],
  ["bottom-right", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-md"],
] as const;

/** The presentational frame around a QR camera view: viewfinder, one help line, manual fallback. */
export function QrFrame({
  mode = "voter",
  children,
  onManualEntry,
  state = "scanning",
  code,
  labels: labelOverrides,
  className,
}: QrFrameProps) {
  const labels = { ...QR_FRAME_LABELS, ...labelOverrides };
  const text = bodyText(mode);
  return (
    <section
      data-component="qr-frame"
      data-mode={mode}
      data-state={state}
      data-print="hide"
      aria-label="QR code scanner"
      className={cn(
        "vbt-scanner flex flex-col items-center gap-4 rounded-lg bg-surface-inverse p-6 text-on-inverse",
        className,
      )}
    >
      {/* 220px viewfinder with four brand-orange corner brackets. */}
      <div className="relative size-55 overflow-hidden rounded-md">
        {children}
        {CORNERS.map(([corner, position]) => (
          <span
            key={corner}
            data-corner={corner}
            aria-hidden="true"
            className={cn("absolute size-8 border-brand-orange", position)}
          />
        ))}
      </div>
      {state === "found" ? (
        <div role="status" className="flex flex-col items-center gap-2">
          <p className={cn(text, "flex items-center gap-2 font-semibold")}>
            <Icon name="check" size={iconSize(mode)} />
            {labels.found}
          </p>
          {code ? (
            <p className={cn("font-mono wrap-anywhere", mode === "admin" ? "text-code" : "text-code-lg")}>{code}</p>
          ) : null}
        </div>
      ) : (
        <p className={cn(text, "text-center")}>{labels.help}</p>
      )}
      <Button
        variant="secondary"
        mode={mode}
        inverse
        onClick={onManualEntry}
      >
        {labels.manualEntry}
      </Button>
    </section>
  );
}
