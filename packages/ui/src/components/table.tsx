import type { ComponentProps } from "react";
import type { Mode } from "../lib/mode";
import { cn } from "../lib/utils";

export type TableProps = ComponentProps<"table"> & {
  mode?: Mode;
  /** Classes for the scrolling card around the table (a max height, say, so the sticky header shows). */
  wrapperClassName?: string;
};

/** A table in its own radius-sm container. Wide tables scroll inside the card; the page never scrolls sideways. */
export function Table({ className, wrapperClassName, mode = "admin", ...props }: TableProps) {
  return (
    <div
      data-component="table"
      data-mode={mode}
      className={cn(
        "vbt-table-wrap relative w-full overflow-x-auto rounded-sm bg-surface-raised shadow-card",
        wrapperClassName,
      )}
    >
      <table
        className={cn(
          "vbt-table w-full border-collapse text-left text-ink",
          mode === "admin" ? "text-small" : "text-body-lg",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/** The header row stays pinned while the table scrolls. */
export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("sticky top-0 z-10 bg-surface-sunk", className)} {...props} />;
}

export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

export type TableRowProps = ComponentProps<"tr"> & { selected?: boolean };

/** Rows are separated by 1px line dividers; hover and selected rows tint with surface-sunk (PrecinctTable README). */
export function TableRow({ className, selected, ...props }: TableRowProps) {
  return (
    <tr
      data-selected={selected ? "true" : undefined}
      className={cn("border-b border-line last:border-b-0 transition-colors duration-fast ease-out hover:bg-surface-sunk data-[selected=true]:bg-surface-sunk motion-reduce:transition-none", className)}
      {...props}
    />
  );
}

export type TableHeadProps = ComponentProps<"th"> & { numeric?: boolean };

/** Muted 13px headers. */
export function TableHead({ className, numeric, scope = "col", ...props }: TableHeadProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-3 py-3 text-label uppercase whitespace-nowrap text-ink-muted",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export type TableCellProps = ComponentProps<"td"> & { numeric?: boolean };

/** Counts and totals use tabular numbers, right-aligned. */
export function TableCell({ className, numeric, ...props }: TableCellProps) {
  return (
    <td
      data-numeric={numeric ? "true" : undefined}
      className={cn("px-3 py-3 align-middle", numeric && "text-right tabular-nums", className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption className={cn("px-3 py-3 text-left text-ink-muted caption-bottom", className)} {...props} />;
}
