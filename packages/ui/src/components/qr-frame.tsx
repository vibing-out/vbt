"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { bodyText, iconSize, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { Icon } from "./icon";

export interface QrFrameLabels {
  help: string;
  manualEntry: string;
  close: string;
  found: string;
  wrongCode: string;
}

/** QRScanner README wording. */
export const QR_FRAME_LABELS: QrFrameLabels = {
  help: "Point at the QR code on your slip.",
  manualEntry: "Type the code instead",
  close: "Close scanner",
  found: "Code found, opening your ballot",
  wrongCode: "That QR code isn't a VBT receipt.",
};

export type QrFrameState = "scanning" | "found" | "wrong-code";

export interface QrFrameProps {
  mode?: Mode;
  /** The camera view, provided by the consumer. This frame never touches the camera or decodes. */
  children?: ReactNode;
  state?: QrFrameState;
  /** Closes the scanner (close button and Escape). Focus returns to whatever had it on open. */
  onClose?: () => void;
  /** Opens CodeEntry. */
  onManualEntry?: () => void;
  /** Move focus to the close button on mount, and back on unmount. Off only for static demos. */
  focusOnOpen?: boolean;
  labels?: Partial<QrFrameLabels>;
  className?: string;
}

// Four corner brackets: 3px, radius-sm corners.
const CORNERS = [
  ["top-left", "top-0 left-0 border-t-3 border-l-3 rounded-tl-sm"],
  ["top-right", "top-0 right-0 border-t-3 border-r-3 rounded-tr-sm"],
  ["bottom-left", "bottom-0 left-0 border-b-3 border-l-3 rounded-bl-sm"],
  ["bottom-right", "bottom-0 right-0 border-b-3 border-r-3 rounded-br-sm"],
] as const;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-inverse";

/** The presentational scanner: viewfinder, help line, close button, live status and the typed-code fallback. */
export function QrFrame({
  mode = "voter",
  children,
  state = "scanning",
  onClose,
  onManualEntry,
  focusOnOpen = true,
  labels: labelOverrides,
  className,
}: QrFrameProps) {
  const labels = { ...QR_FRAME_LABELS, ...labelOverrides };
  const text = bodyText(mode);
  const target = mode === "voter" ? "min-h-11 min-w-11" : "min-h-6 min-w-6";
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves to the close button on open and returns to the trigger on close.
  useEffect(() => {
    if (!focusOnOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => trigger?.focus();
  }, [focusOnOpen]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && onClose) {
      event.stopPropagation();
      onClose();
    }
  }

  const status = state === "found" ? labels.found : state === "wrong-code" ? labels.wrongCode : "";

  return (
    <section
      data-component="qr-frame"
      data-mode={mode}
      data-state={state}
      data-print="hide"
      aria-label="QR code scanner"
      onKeyDown={onKeyDown}
      className={cn(
        "vbt-scanner relative flex flex-col items-center gap-4 bg-surface-inverse p-6 text-on-inverse sm:rounded-lg",
        className,
      )}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label={labels.close}
        onClick={onClose}
        className={cn(
          "absolute top-2 right-2 inline-flex cursor-pointer items-center justify-center rounded-sm text-on-inverse",
          target,
          FOCUS,
        )}
      >
        <Icon name="x" size={iconSize(mode)} />
      </button>
      {/* Polite live region, above the viewfinder: the wrong-code message and "Code found". */}
      <p role="status" aria-live="polite" className={cn(text, "min-h-7 text-center text-on-inverse")}>
        {status}
      </p>
      <div data-slot="preview" className="relative size-55 overflow-hidden">
        {children}
        {/* The square viewfinder, with surface-inverse at 60% dimming everything outside it. */}
        <div
          aria-hidden="true"
          data-slot="viewfinder"
          className="absolute inset-6 rounded-sm ring-[100vmax] ring-surface-inverse/60"
        >
          {CORNERS.map(([corner, position]) => (
            <span
              key={corner}
              data-corner={corner}
              className={cn(
                "absolute size-8 transition-colors duration-fast ease-out motion-reduce:transition-none",
                state === "found" ? "border-brand-orange" : "border-on-inverse",
                position,
              )}
            />
          ))}
        </div>
      </div>
      <p className={cn(text, "text-center text-on-inverse")}>{labels.help}</p>
      <button
        type="button"
        onClick={onManualEntry}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center rounded-sm px-2 text-on-inverse underline underline-offset-4",
          text,
          target,
          FOCUS,
        )}
      >
        {labels.manualEntry}
      </button>
    </section>
  );
}
