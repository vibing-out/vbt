import { Fragment } from "react";
import type { Mode } from "../lib/mode";
import { cn } from "../lib/utils";

export interface CodeTextProps {
  /** Shown exactly as passed in; formatting belongs to the code generator (T-05). */
  code: string;
  mode?: Mode;
  /** "lg" for a code shown on its own (code-lg), "inline" for a code inside a sentence or table (code). */
  size?: "lg" | "inline";
  className?: string;
}

/**
 * A tracking code in mono. Each hyphen-separated group stays on one line; a line may break only
 * after a hyphen (design system README, Type).
 */
export function CodeText({ code, mode = "voter", size = "lg", className }: CodeTextProps) {
  const groups = code.split("-");
  const last = groups.length - 1;
  const style = size === "lg" && mode === "voter" ? "text-code-lg" : "text-code";
  return (
    <span data-slot="code" className={cn("font-mono", style, className)}>
      {groups.map((group, i) => (
        <Fragment key={i}>
          <span data-slot="code-group" className="whitespace-nowrap">
            {i < last ? `${group}-` : group}
          </span>
          {i < last ? <wbr /> : null}
        </Fragment>
      ))}
    </span>
  );
}
