# StageTimeline

The signature of VBT: four dots on a line showing where a ballot is, with the current stage in orange.

**Mode:** voter (also used read-only in admin ballot detail).

## When to use

On the tracker, inside the hero card, directly under the status headline. Once per screen.

## Stages

Always four, in this order, from the locked state machine:

| # | Status | Label |
| --- | --- | --- |
| 1 | `CAST` | Cast and sealed |
| 2 | `TALLIED_PRECINCT` | Counted at precinct |
| 3 | `REPORTED_UNOFFICIAL` | Election-night results |
| 4 | `CERTIFIED` | Certified |

`CHALLENGED`, `DISCARDED` and `SPOILED` are not stages; they modify the timeline (see Exceptions).

## Anatomy

1. **Track:** a 2px line through the centers of the dots. The part up to the current stage fills with `stage-done` (on light surfaces) or `on-inverse-muted` (on the hero card).
2. **Dots:** 16px circles.
   - Done: filled `ink` (or `on-inverse` on the hero card) with a `check` icon cut out.
   - Current: filled `accent-mark` with a 6px halo of `accent-tint` (or `brand-orange` at 30% on the hero card).
   - Upcoming: 2px ring of `line-strong` (or `on-inverse-muted`), empty center.
3. **Labels:** stage label in `body-lg` weight 600 for the current stage in `accent-text` (or `brand-orange` on the hero card), others in `ink-muted`. The word "Now" as a `label` eyebrow above the current label.
4. **Date:** under each done or current label, "Nov 3" in `ink-muted`. Upcoming stages show an expected window instead ("Expected by Nov 18").

## Layout

- **Vertical (default on phones and in voter mode):** dots in a column on the left, label and date to the right, `space-3` between rows. Best for long labels and screen magnifiers.
- **Horizontal (hero card at 480px wide and up):** dots on one line, labels centered below each dot, wrapping to two lines.

## Exceptions

| Status | Treatment |
| --- | --- |
| `CHALLENGED` | The dot of the stage held before the challenge becomes a `status-challenged` dot with a `flag` icon; label "Under review" with the reason below. Later stages stay upcoming. |
| `DISCARDED` | The track stops at the last reached stage; a fifth terminal node in `status-discarded` with an `x` icon and "Not counted: <reason>". Later stages are removed, not greyed. |
| `SPOILED` | No timeline. Show the Spoiled StatusBadge and a link to the replacement ballot's code if the voter has it. |

## States

- **Loading:** four upcoming rings and skeleton labels; never a spinner in place of the timeline.
- **Live update:** when the current stage advances while open, the track fills over `duration-slow` and the new label is announced.

## Accessibility

- An ordered list (`ol`) with one `li` per stage. The current item has `aria-current="step"`.
- Each item's accessible text reads in full: "Stage 2 of 4, Counted at precinct, done, Nov 3."
- Dots are decorative (`aria-hidden`); meaning is in the text.
- A polite live region announces "Your ballot moved to Election-night results."
- Contrast pairs used: `ink` and `accent-text` on `surface-raised`; `on-inverse`, `on-inverse-muted` and `brand-orange` on `surface-inverse`; `accent-mark` and `line-strong` marks at 3:1.

## Acceptance checks

- [ ] Renders all seven statuses correctly, including the three exceptions.
- [ ] Current stage is identifiable in grayscale (the "Now" label and filled dot).
- [ ] No time of day appears anywhere, only dates.
- [ ] Screen reader reads stage number, label, state and date for each item.
- [ ] Reduced motion: the track fill is instant.
