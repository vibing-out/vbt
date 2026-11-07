"use client";

import { useEffect, useRef, useState } from "react";
import { bodyText, dateOnly, smallText, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { STAGE_LABELS, STAGES, type Stage } from "../status";
import { CodeText } from "./code-text";
import { Icon, type IconName } from "./icon";
import { StatusBadge } from "./status-badge";

export type StageState = "done" | "current" | "upcoming";

export interface StageEntry {
  stage: Stage;
  state: StageState;
  /** Done or current: the date reached, such as "Nov 3". Never a time of day. */
  date?: string;
  /** Upcoming: the expected date, shown as "Expected by Nov 18". Never a time of day. */
  expected?: string;
}

/**
 * The ballot left the four-stage path (StageTimeline README, Exceptions). CHALLENGED and
 * DISCARDED carry their reason; SPOILED replaces the timeline with its badge and, if known, a link
 * to the replacement ballot.
 */
export type OffPath =
  | { status: "CHALLENGED"; reason: string }
  | { status: "DISCARDED"; reason: string; date?: string }
  | { status: "SPOILED"; replacement?: { code: string; href: string } };

export interface StageTimelineProps {
  /** Stage states and dates. Rendered in the fixed order; a stage left out is upcoming. */
  stages: readonly StageEntry[];
  offPath?: OffPath;
  /** "raised" on light cards; "hero" inside the dark hero card, horizontal at 480px wide and up. */
  surface?: "raised" | "hero";
  mode?: Mode;
  /** Four upcoming rings and skeleton labels; never a spinner. */
  loading?: boolean;
  /** Replaces stage labels (for Spanish strings, say). */
  labels?: Partial<Record<Stage, string>>;
  className?: string;
}

type NodeKind = "done" | "current" | "upcoming" | "challenged" | "discarded";

interface Node {
  key: string;
  kind: NodeKind;
  /** Stage this node stands for; undefined for the terminal discarded node. */
  stage?: Stage;
  label: string;
  /** Shown under the label: a date, "Expected by ...", or the reason. */
  detail?: string;
  /** The item's full accessible text. */
  spoken: string;
}

const TOTAL = STAGES.length;

/** Nodes that mark where the ballot is: "Now" and aria-current="step". */
const AT: ReadonlySet<NodeKind> = new Set(["current", "challenged", "discarded"]);

function spokenFor(n: number, label: string, state: string, detail?: string): string {
  return `Stage ${n} of ${TOTAL}, ${label}, ${state}${detail ? `, ${detail}` : ""}.`;
}

function resolveNodes(props: StageTimelineProps): Node[] {
  const { offPath } = props;
  const entries = STAGES.map((stage, i) => {
    const entry = props.stages.find((s) => s.stage === stage);
    return {
      stage,
      n: i + 1,
      state: entry?.state ?? ("upcoming" as StageState),
      date: dateOnly(entry?.date, `The ${stage} date`),
      expected: dateOnly(entry?.expected, `The ${stage} expected date`),
      label: props.labels?.[stage] ?? STAGE_LABELS[props.mode ?? "voter"][stage],
    };
  });

  const plain = (e: (typeof entries)[number], kind: "done" | "current" | "upcoming"): Node => {
    const detail = kind === "upcoming" ? (e.expected ? `Expected by ${e.expected}` : undefined) : e.date;
    const spokenDetail = kind === "upcoming" && e.expected ? `expected by ${e.expected}` : detail;
    return { key: e.stage, kind, stage: e.stage, label: e.label, detail, spoken: spokenFor(e.n, e.label, kind, spokenDetail) };
  };

  if (offPath?.status === "CHALLENGED") {
    // The stage held before the challenge: the current one, or else the last one done.
    const current = entries.findIndex((e) => e.state === "current");
    const held = current >= 0 ? current : entries.map((e) => e.state).lastIndexOf("done");
    return entries.map((e, i) => {
      if (i === held) {
        return {
          key: e.stage,
          kind: "challenged",
          stage: e.stage,
          label: "Under review",
          detail: offPath.reason,
          spoken: spokenFor(e.n, e.label, "under review", offPath.reason),
        };
      }
      return plain(e, i < held ? "done" : "upcoming");
    });
  }

  if (offPath?.status === "DISCARDED") {
    // The track stops at the last reached stage; later stages are removed, not greyed.
    const reached = entries.filter((e) => e.state !== "upcoming").map((e) => plain(e, "done"));
    const date = dateOnly(offPath.date, "The discarded date");
    const label = `Not counted: ${offPath.reason}`;
    return [
      ...reached,
      { key: "DISCARDED", kind: "discarded", label, detail: date, spoken: `${label}${date ? `, ${date}` : ""}.` },
    ];
  }

  return entries.map((e) => plain(e, e.state));
}

// Colors by surface (StageTimeline README, Anatomy). The done check and exception icons are cut
// out: drawn in the surface color. On the hero, status colors fail on surface-inverse in light
// (2.11:1 to 2.76:1), so challenged and discarded dots use on-inverse; the icon and word carry them.
const TONE = {
  raised: {
    dot: {
      done: "bg-ink text-surface-raised",
      current: "bg-accent-mark ring-6 ring-accent-tint",
      upcoming: "border-2 border-line-strong bg-surface-raised",
      challenged: "bg-status-challenged text-surface-raised",
      discarded: "bg-status-discarded text-surface-raised",
    },
    label: {
      done: "text-ink-muted",
      current: "font-semibold text-accent-text",
      upcoming: "text-ink-muted",
      challenged: "font-semibold text-status-challenged",
      discarded: "font-semibold text-status-discarded",
    },
    now: "text-ink",
    detail: "text-ink-muted",
    trackFilled: "bg-stage-done",
    trackEmpty: "bg-line",
    skeleton: "bg-surface-sunk",
    link: "text-ink focus-visible:outline-focus",
  },
  hero: {
    dot: {
      done: "bg-on-inverse text-surface-inverse",
      current: "bg-brand-orange ring-6 ring-brand-orange/30",
      upcoming: "border-2 border-on-inverse-muted bg-surface-inverse",
      challenged: "bg-on-inverse text-surface-inverse",
      discarded: "bg-on-inverse text-surface-inverse",
    },
    label: {
      done: "text-on-inverse-muted",
      current: "font-semibold text-brand-orange",
      upcoming: "text-on-inverse-muted",
      challenged: "font-semibold text-on-inverse",
      discarded: "font-semibold text-on-inverse",
    },
    now: "text-on-inverse",
    detail: "text-on-inverse-muted",
    trackFilled: "bg-on-inverse-muted",
    trackEmpty: "bg-on-inverse-muted/30",
    skeleton: "bg-on-inverse-muted/30",
    link: "text-on-inverse focus-visible:outline-focus-inverse",
  },
} as const;

const DOT_ICON: Partial<Record<NodeKind, IconName>> = { done: "check", challenged: "flag", discarded: "x" };

// Horizontal layout, for the hero card at 480px (30rem) wide and up. Written out in full so
// Tailwind finds every class.
const HORIZONTAL = {
  root: "@container",
  ol: "@min-[30rem]:grid @min-[30rem]:auto-cols-fr @min-[30rem]:grid-flow-col",
  li: "@min-[30rem]:flex-col @min-[30rem]:items-center @min-[30rem]:gap-2 @min-[30rem]:px-1 @min-[30rem]:pb-0 @min-[30rem]:text-center",
  dotBox: "@min-[30rem]:h-4",
  track:
    "@min-[30rem]:bottom-auto @min-[30rem]:left-1/2 @min-[30rem]:h-0.5 @min-[30rem]:w-full @min-[30rem]:translate-x-0 @min-[30rem]:-translate-y-1/2",
  fill: "@min-[30rem]:origin-left",
  fillEmpty: "@min-[30rem]:scale-x-0 @min-[30rem]:scale-y-100",
  text: "@min-[30rem]:items-center",
};

/** Where a ballot is on the four stages, with the current stage in orange and marked "Now". */
export function StageTimeline(props: StageTimelineProps) {
  const { offPath, surface = "raised", mode = "voter", loading = false, className } = props;
  const tone = TONE[surface];
  const hero = surface === "hero";
  const nodes = loading ? [] : resolveNodes(props);

  // Live update: announce a newly reached stage once, politely.
  const currentStage = nodes.find((n) => n.kind === "current")?.stage;
  const previous = useRef(currentStage);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const before = previous.current;
    previous.current = currentStage;
    if (!currentStage || !before || currentStage === before) return;
    if (STAGES.indexOf(currentStage) > STAGES.indexOf(before)) {
      setAnnouncement(`Your ballot moved to ${props.labels?.[currentStage] ?? STAGE_LABELS[mode][currentStage]}.`);
    }
  }, [currentStage, props.labels, mode]);

  const root = {
    "data-component": "timeline",
    "data-surface": surface,
    "data-mode": mode,
    "data-off-path": offPath?.status,
  };

  if (offPath?.status === "SPOILED" && !loading) {
    // SPOILED is not a stage: no timeline, just the badge and the replacement ballot if known.
    return (
      <div {...root} className={cn("vbt-timeline flex flex-col items-start gap-2", className)}>
        <StatusBadge status="SPOILED" mode={mode} />
        {offPath.replacement ? (
          <a
            href={offPath.replacement.href}
            className={cn(
              "inline-flex flex-wrap items-center gap-x-2 underline underline-offset-4",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
              mode === "voter" ? "min-h-11" : "min-h-6",
              bodyText(mode),
              tone.link,
            )}
          >
            Track your replacement ballot
            <CodeText code={offPath.replacement.code} mode={mode} size="inline" />
          </a>
        ) : null}
      </div>
    );
  }

  const shown: Node[] = loading
    ? STAGES.map((stage, i) => ({
        key: stage,
        kind: "upcoming",
        stage,
        label: "",
        spoken: `Stage ${i + 1} of ${TOTAL}, loading.`,
      }))
    : nodes;
  const text = bodyText(mode);

  return (
    <div {...root} className={cn("vbt-timeline", hero && HORIZONTAL.root, className)}>
      <ol aria-label="Stages" aria-busy={loading || undefined} className={cn("flex flex-col", hero && HORIZONTAL.ol)}>
        {shown.map((node, i) => {
          const at = AT.has(node.kind);
          const next = shown[i + 1];
          const filled = next !== undefined && next.kind !== "upcoming";
          const icon = DOT_ICON[node.kind];
          return (
            <li
              key={node.key}
              data-stage={node.stage}
              data-state={node.kind}
              aria-current={at ? "step" : undefined}
              className={cn("relative flex gap-3 pb-3 last:pb-0", hero && HORIZONTAL.li)}
            >
              {next ? (
                // The 2px track from this dot's center to the next one's.
                <span
                  aria-hidden="true"
                  data-slot="track"
                  data-filled={filled ? "true" : "false"}
                  className={cn(
                    "absolute top-2 -bottom-3.5 left-2 w-0.5 -translate-x-1/2 overflow-hidden",
                    tone.trackEmpty,
                    hero && HORIZONTAL.track,
                  )}
                >
                  <span
                    className={cn(
                      "absolute inset-0 origin-top transition-transform duration-slow ease-out motion-reduce:transition-none",
                      tone.trackFilled,
                      hero && HORIZONTAL.fill,
                      filled ? "scale-100" : cn("scale-y-0", hero && HORIZONTAL.fillEmpty),
                    )}
                  />
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex w-4 shrink-0 items-center justify-center",
                  at ? "h-4" : mode === "voter" ? "h-7" : "h-6",
                  hero && HORIZONTAL.dotBox,
                )}
              >
                <span
                  data-slot="dot"
                  className={cn("flex size-4 items-center justify-center rounded-pill", tone.dot[node.kind])}
                >
                  {icon && !loading ? <Icon name={icon} size={12} /> : null}
                </span>
              </span>
              <span className="sr-only">{node.spoken}</span>
              <span aria-hidden="true" className={cn("flex min-w-0 flex-col", hero && HORIZONTAL.text)}>
                {loading ? (
                  <span data-slot="skeleton" className={cn("my-2 block h-4 w-32 max-w-full rounded-sm", tone.skeleton)} />
                ) : (
                  <>
                    {at ? <span className={cn("text-label uppercase", tone.now)}>Now</span> : null}
                    <span className={cn(text, tone.label[node.kind])}>{node.label}</span>
                    {node.detail ? <span className={cn(smallText(mode), tone.detail)}>{node.detail}</span> : null}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
