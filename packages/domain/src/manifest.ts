// Election manifest and ballot choice rules.
// Source: docs/locked-interfaces.md (Election manifest: the JSON manifest of contests and choices,
// published in the election record; ballots.ballot_style names the style a ballot was cast on).
// No I/O: callers parse their input into these shapes, then ask checkChoices or summarizeChoices.

export interface Selection {
  readonly id: string;
  readonly name: string;
}

export interface Contest {
  readonly id: string;
  readonly title: string;
  /** How many selections a voter may make in this contest. */
  readonly vote_for: number;
  readonly selections: readonly Selection[];
}

export interface BallotStyle {
  readonly id: string;
  /** The contests on this style, in ballot order. */
  readonly contest_ids: readonly string[];
}

export interface Manifest {
  readonly contests: readonly Contest[];
  readonly ballot_styles: readonly BallotStyle[];
}

/** Contest id -> selected selection ids. A contest on the style that is missing here is an undervote. */
export type BallotChoices = Readonly<Record<string, readonly string[]>>;

export type ChoiceErrorCode =
  | "UNKNOWN_BALLOT_STYLE"
  | "UNKNOWN_CONTEST"
  | "DUPLICATE_CONTEST"
  | "CONTEST_NOT_ON_STYLE"
  | "DUPLICATE_SELECTION"
  | "OVERVOTE"
  | "UNKNOWN_SELECTION";

export interface ChoiceProblem {
  readonly code: ChoiceErrorCode;
  /** The contest the problem is in; absent for an unknown ballot style. */
  readonly contestId?: string;
  /** The offending selection, for DUPLICATE_SELECTION and UNKNOWN_SELECTION. */
  readonly selectionId?: string;
  readonly message: string;
}

export interface ContestSummary {
  readonly contestId: string;
  readonly title: string;
  readonly voteFor: number;
  /** Selection names in the order chosen, or empty for an undervote. */
  readonly selected: readonly string[];
}

export type ChoiceSummaryResult =
  | { readonly ok: true; readonly contests: readonly ContestSummary[] }
  | ({ readonly ok: false } & ChoiceProblem);

/**
 * The first problem with a ballot's choices, or null when they are valid for the style. Checked per
 * contest, in the order the choices list them:
 *
 * - the ballot style is in the manifest, and every contest it lists is too;
 * - the ballot style lists each contest once;
 * - each contest chosen is on the ballot style;
 * - no selection is chosen twice in a contest;
 * - no more than vote_for selections are chosen (an overvote is rejected; fewer is an undervote);
 * - each selection belongs to its contest.
 */
export function checkChoices(manifest: Manifest, styleId: string, choices: BallotChoices): ChoiceProblem | null {
  const style = manifest.ballot_styles.find((s) => s.id === styleId);
  if (!style) return { code: "UNKNOWN_BALLOT_STYLE", message: `Unknown ballot style ${styleId}` };

  const listed = new Set<string>();
  for (const contestId of style.contest_ids) {
    if (!manifest.contests.some((c) => c.id === contestId)) {
      return { code: "UNKNOWN_CONTEST", contestId, message: `Unknown contest ${contestId} on ballot style ${styleId}` };
    }
    if (listed.has(contestId)) {
      return {
        code: "DUPLICATE_CONTEST",
        contestId,
        message: `Ballot style ${styleId} lists contest ${contestId} more than once`,
      };
    }
    listed.add(contestId);
  }

  for (const [contestId, picked] of Object.entries(choices)) {
    const contest = manifest.contests.find((c) => c.id === contestId);
    if (!contest || !style.contest_ids.includes(contestId)) {
      return {
        code: "CONTEST_NOT_ON_STYLE",
        contestId,
        message: `Contest ${contestId} is not on ballot style ${styleId}`,
      };
    }
    const seen = new Set<string>();
    for (const id of picked) {
      if (seen.has(id)) {
        return {
          code: "DUPLICATE_SELECTION",
          contestId,
          selectionId: id,
          message: `Contest ${contestId} selects the same choice twice (${id})`,
        };
      }
      seen.add(id);
    }
    if (picked.length > contest.vote_for) {
      return {
        code: "OVERVOTE",
        contestId,
        message: `Contest ${contestId} selects more than ${contest.vote_for}`,
      };
    }
    for (const id of picked) {
      if (!contest.selections.some((s) => s.id === id)) {
        return {
          code: "UNKNOWN_SELECTION",
          contestId,
          selectionId: id,
          message: `Unknown selection ${id} in contest ${contestId}`,
        };
      }
    }
  }

  return null;
}

/**
 * Every contest on the ballot style, in style order, with the names of what was selected. Undervoted
 * contests are included with no selections. Invalid choices (see checkChoices) are refused, never
 * summarized. Never throws.
 */
export function summarizeChoices(manifest: Manifest, styleId: string, choices: BallotChoices): ChoiceSummaryResult {
  const problem = checkChoices(manifest, styleId, choices);
  if (problem) return { ok: false, ...problem };

  // checkChoices proved the style, its contests and every selection exist.
  const style = manifest.ballot_styles.find((s) => s.id === styleId) as BallotStyle;
  const contests = style.contest_ids.map((contestId): ContestSummary => {
    const contest = manifest.contests.find((c) => c.id === contestId) as Contest;
    const picked = Object.hasOwn(choices, contestId) ? choices[contestId] : [];
    const selected = (picked as readonly string[]).map((id) => (contest.selections.find((s) => s.id === id) as Selection).name);
    return { contestId, title: contest.title, voteFor: contest.vote_for, selected };
  });
  return { ok: true, contests };
}
