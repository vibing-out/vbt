"use client";

import { useEffect, useState } from "react";
import type { Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { CodeText } from "./code-text";
import { Icon } from "./icon";

export interface CopyCodeProps {
  /** Shown exactly as passed in; formatting belongs to the code generator (T-05). */
  code: string;
  mode?: Mode;
  /** "inverse" on surface-inverse (receipt pass, hero card); "raised" on light cards. */
  surface?: "inverse" | "raised";
  copyLabel?: string;
  copiedLabel?: string;
  className?: string;
}

const BUTTON = {
  // Control edges: on-inverse-muted on surface-inverse, line-strong on light surfaces.
  inverse: "border-on-inverse-muted text-on-inverse focus-visible:outline-focus-inverse",
  raised: "border-line-strong text-ink focus-visible:outline-focus",
} as const;

/** The tracking code as selectable text, with a "Copy code" button that announces "Code copied". */
export function CopyCode({
  code,
  mode = "voter",
  surface = "inverse",
  copyLabel = "Copy code",
  copiedLabel = "Code copied",
  className,
}: CopyCodeProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code stays visible and selectable.
    }
  }

  return (
    <div data-slot="copy-code" className={cn("vbt-copy-code flex min-w-0 flex-col items-start gap-2", className)}>
      <CodeText code={code} mode={mode} />
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 rounded-sm border font-semibold",
          "transition-colors duration-fast ease-out motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          mode === "admin" ? "min-h-9 px-3 text-body" : "min-h-11 px-4 text-body-lg",
          BUTTON[surface],
        )}
      >
        <Icon name={copied ? "check" : "copy"} size={mode === "admin" ? 16 : 20} />
        {copied ? copiedLabel : copyLabel}
      </button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </div>
  );
}
