"use client";

import { useEffect, useState } from "react";
import type { Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { Icon } from "./icon";

export interface CopyCodeProps {
  /** Shown exactly as passed in; formatting belongs to the code generator (T-05). */
  code: string;
  mode?: Mode;
  copyLabel?: string;
  copiedLabel?: string;
  className?: string;
}

/** The tracking code as its own chip on a dark hero, with a copy button. */
export function CopyCode({
  code,
  mode = "voter",
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
    <div
      className={cn(
        "vbt-code-chip inline-flex max-w-full items-center gap-2 self-start rounded-sm border border-on-inverse-muted py-1 pr-1 pl-3",
        className,
      )}
    >
      <span className={cn("min-w-0 font-mono wrap-anywhere", mode === "admin" ? "text-code" : "text-code-lg")}>{code}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? copiedLabel : copyLabel}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm text-on-inverse",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse",
          mode === "admin" ? "size-9" : "size-11",
        )}
      >
        <Icon name={copied ? "check" : "copy"} size={mode === "admin" ? 16 : 20} />
      </button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </div>
  );
}
