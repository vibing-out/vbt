import { bodyText, dateOnly, iconSize, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { ADMIN_LABELS, STAGES, STATUS_ICONS, VOTER_LABELS, type ReasonStatus, type Stage } from "../status";
import { CopyCode } from "./copy-code";
import { Icon } from "./icon";
import { StatusBadge } from "./status-badge";

export type StageState = "done" | "current" | "upcoming";

export interface StageEntry {
  stage: Stage;
  state: StageState;
  /** A date only, such as "Nov 3". Never a time of day: that would reveal casting order. */
  date?: string;
}

/** The ballot left the four-stage path. Challenged and Discarded need their reason. */
export type OffPath = { status: ReasonStatus; reason: string } | { status: "SPOILED"; reason?: string };

interface CommonProps {
  mode?: Mode;
  /** Stage states and dates. Rendered in the fixed order; a stage left out is upcoming. */
  stages: readonly StageEntry[];
  offPath?: OffPath;
  /** The stage whose batch just landed: only its circle animates (200ms, none under reduced motion). */
  justCompleted?: Stage;
  /** Replaces stage names (for Spanish strings, say). */
  labels?: Partial<Record<Stage, string>>;
  className?: string;
}

export type HeroTimelineProps = CommonProps & {
  form: "hero";
  /** The current status as one plain-language sentence, e.g. "Your ballot is counted". */
  headline: string;
  /** One sentence naming the next step and roughly when. */
  nextStep: string;
  /** Shown exactly as passed in. */
  code: string;
  county: string;
  precinct: string;
  /** When an official's batch last landed, e.g. "9:42 PM": the only time shown. */
  updatedAt: string;
};

export type HistoryTimelineProps = CommonProps & {
  form: "history";
  /** Note carried by the current row. */
  nextStep?: string;
};

export type CompactTimelineProps = CommonProps & { form: "compact" };

export type StageTimelineProps = HeroTimelineProps | HistoryTimelineProps | CompactTimelineProps;

interface ResolvedStage {
  stage: Stage;
  state: StageState;
  date?: string;
  label: string;
  isNew: boolean;
}

/**
 * The four stages in fixed order. Off the path, every stage after the last completed one shows as
 * upcoming: a stage is never colored with a status color.
 */
function resolveStages(props: CommonProps, mode: Mode): ResolvedStage[] {
  const names = mode === "admin" ? ADMIN_LABELS : VOTER_LABELS;
  return STAGES.map((stage) => {
    const entry = props.stages.find((s) => s.stage === stage);
    let state: StageState = entry?.state ?? "upcoming";
    if (props.offPath && state !== "done") state = "upcoming";
    return {
      stage,
      state,
      date: dateOnly(entry?.date, `The ${stage} date`),
      label: props.labels?.[stage] ?? names[stage],
      isNew: props.justCompleted === stage && state === "done",
    };
  });
}

const STATE_WORD: Record<StageState, string> = { done: "done", current: "current", upcoming: "upcoming" };

/** Only the newly completed circle animates. */
const NEW_MOTION =
  "transition-colors duration-200 ease-out animate-in fade-in zoom-in-75 motion-reduce:transition-none motion-reduce:animate-none";

function OffPathBadge({ offPath, mode }: { offPath: OffPath; mode: Mode }) {
  return offPath.status === "SPOILED" ? (
    <StatusBadge status="SPOILED" reason={offPath.reason} mode={mode} />
  ) : (
    <StatusBadge status={offPath.status} reason={offPath.reason} mode={mode} />
  );
}

function rootProps(form: StageTimelineProps["form"], mode: Mode, offPath: OffPath | undefined) {
  return {
    "data-component": "timeline",
    "data-form": form,
    "data-mode": mode,
    "data-off-path": offPath?.status,
  };
}

export function StageTimeline(props: StageTimelineProps) {
  const mode = props.mode ?? "voter";
  const stages = resolveStages(props, mode);
  if (props.form === "hero") return <Hero {...props} mode={mode} stages_={stages} />;
  if (props.form === "history") return <History {...props} mode={mode} stages_={stages} />;
  return <Compact {...props} mode={mode} stages_={stages} />;
}

type Resolved<P> = P & { mode: Mode; stages_: ResolvedStage[] };

function Hero({ mode, stages_, offPath, headline, nextStep, code, county, precinct, updatedAt, className }: Resolved<HeroTimelineProps>) {
  const circle: Record<StageState, string> = {
    done: "bg-on-inverse text-surface-inverse",
    current: "bg-brand-orange text-on-accent ring-4 ring-brand-orange/30",
    upcoming: "border-2 border-on-inverse-muted text-on-inverse-muted",
  };
  return (
    <section
      {...rootProps("hero", mode, offPath)}
      aria-label="Ballot status"
      className={cn(
        "vbt-timeline vbt-hero flex flex-col gap-6 rounded-lg bg-surface-inverse p-4 text-on-inverse shadow-overlay md:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-3">
        <p className="text-label uppercase text-on-inverse-muted">
          {county} · {precinct} · Updated {updatedAt}
        </p>
        <h2 className="text-display">{headline}</h2>
        {offPath ? (
          <div>
            <OffPathBadge offPath={offPath} mode={mode} />
          </div>
        ) : null}
        <p className={bodyText(mode)}>{nextStep}</p>
      </div>
      <ol className="flex items-center" aria-label="Stages">
        {stages_.map((s, i) => (
          <li
            key={s.stage}
            data-stage={s.stage}
            data-state={s.state}
            aria-current={s.state === "current" ? "step" : undefined}
            className={cn("flex items-center", i < stages_.length - 1 && "flex-1")}
          >
            <span
              role="img"
              aria-label={`${s.label}, ${STATE_WORD[s.state]}`}
              data-new={s.isNew ? "true" : undefined}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-pill",
                circle[s.state],
                s.isNew && NEW_MOTION,
              )}
            >
              <Icon name={STATUS_ICONS[s.stage]} size={iconSize(mode)} />
            </span>
            {i < stages_.length - 1 ? (
              <span aria-hidden="true" className="mx-2 h-0.5 flex-1 rounded-pill bg-on-inverse-muted" />
            ) : null}
          </li>
        ))}
      </ol>
      <CopyCode code={code} mode={mode} />
    </section>
  );
}

function History({ mode, stages_, offPath, nextStep, className }: Resolved<HistoryTimelineProps>) {
  const circle: Record<StageState, string> = {
    done: "bg-stage-done text-ink",
    current: "bg-brand-orange text-on-accent",
    upcoming: "border-2 border-line-strong bg-surface-raised text-ink-muted",
  };
  const name: Record<StageState, string> = {
    done: "text-ink",
    current: "text-accent-text",
    upcoming: "text-ink-muted",
  };
  const text = bodyText(mode);
  return (
    <div
      {...rootProps("history", mode, offPath)}
      className={cn(
        "vbt-timeline vbt-card vbt-history flex flex-col gap-3 rounded-md bg-surface-raised p-4 text-ink shadow-card md:p-6",
        className,
      )}
    >
      {offPath ? (
        <div>
          <OffPathBadge offPath={offPath} mode={mode} />
        </div>
      ) : null}
      <ol className="flex flex-col gap-1" aria-label="Stages">
        {stages_.map((s) => (
          <li
            key={s.stage}
            data-stage={s.stage}
            data-state={s.state}
            aria-current={s.state === "current" ? "step" : undefined}
            className={cn("flex items-start gap-3 rounded-sm p-3", s.state === "current" && "bg-accent-tint")}
          >
            <span
              role="img"
              aria-label={`${s.label}, ${STATE_WORD[s.state]}`}
              data-new={s.isNew ? "true" : undefined}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-pill",
                circle[s.state],
                s.isNew && NEW_MOTION,
              )}
            >
              <Icon name={STATUS_ICONS[s.stage]} size={iconSize(mode)} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className={cn(text, "font-semibold", name[s.state])}>{s.label}</p>
              {s.date ? <p className={cn(text, "text-ink-muted")}>{s.date}</p> : null}
              {s.state === "current" && nextStep ? <p className={cn(text, "text-ink")}>{nextStep}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Compact({ mode, stages_, offPath, className }: Resolved<CompactTimelineProps>) {
  const segment: Record<StageState, string> = {
    done: "bg-ink",
    current: "bg-accent-mark",
    upcoming: "bg-surface-sunk",
  };
  const name: Record<StageState, string> = {
    done: "text-ink",
    current: "font-semibold text-accent-text",
    upcoming: "text-ink-muted",
  };
  return (
    <div
      {...rootProps("compact", mode, offPath)}
      className={cn("vbt-timeline vbt-seg flex min-w-0 flex-col gap-2", className)}
    >
      <ol className="grid grid-cols-4 gap-1" aria-label="Stages">
        {stages_.map((s) => (
          <li
            key={s.stage}
            data-stage={s.stage}
            data-state={s.state}
            aria-current={s.state === "current" ? "step" : undefined}
            className="flex min-w-0 flex-col gap-1"
          >
            <span
              role="img"
              aria-label={`${s.label}, ${STATE_WORD[s.state]}`}
              data-new={s.isNew ? "true" : undefined}
              className={cn("block h-2 rounded-pill", segment[s.state], s.isNew && NEW_MOTION)}
            />
            <span aria-hidden="true" className={cn(mode === "admin" ? "text-small" : "text-body-lg", name[s.state])}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      {offPath ? (
        <div>
          <OffPathBadge offPath={offPath} mode={mode} />
        </div>
      ) : null}
    </div>
  );
}
