# ChallengeQueue

The list of ballots under review, with the evidence and the two ways to resolve each one: accept (restore its prior status) or reject (discard with a reason).

**Mode:** admin (county officials).

## When to use

On the Challenges screen. Also as a compact count with a link from PrecinctTable's Exceptions column.

## Layout

Split view at desktop width: queue on the left (40%), selected challenge detail on the right. Below 1024px the detail opens as a full-height drawer.

### Queue row

- Tracking code in `code` style, precinct, StatusBadge "Under review".
- Why: the source ("Mismatch: C1 machine count" or "Official challenge").
- Status held before the challenge, as a small StatusBadge.
- Date opened. Age shown as "2 days" when older than one day.
- Checkbox for batch accept.

### Detail panel

1. Heading: the tracking code and "Under review since Nov 3".
2. Reason and source, in full.
3. Evidence: the cross-check that raised it (link to CrossCheckReport row), relevant event history as a short list, ciphertext hash.
4. Resolution form:
   - Radio choice: "Accept: return to Counted at precinct" (the held status, named) or "Reject: mark Not counted".
   - Reason field, required for reject and optional for accept, with common reasons as quick picks.
   - Actor line: "Recorded as: <name>, County official".
   - Button named for the choice: "Accept ballot" or "Mark not counted".

## Behavior

- Resolving opens a confirmation dialog repeating the code, the outcome and the reason. Reject says "This is final."
- After resolving, the next challenge in the queue opens automatically and focus moves to its heading.
- Batch accept (several selected) uses the BatchActionBar and its confirmation dialog. Batch reject is not offered: each discard needs its own reason.
- Filters (source, precinct, age) persist in the URL like PrecinctTable.
- Default sort: oldest first.

## States

| State | Treatment |
| --- | --- |
| Empty | "No ballots under review." with the date of the last resolution |
| Loading detail | Skeleton in the detail panel only; queue stays interactive |
| Conflict (someone else resolved it) | Callout: "This was resolved by <name> on Nov 4." Form disabled, queue refreshes |

## Accessibility

- Queue is a list of buttons or links; the selected item has `aria-current="true"`.
- The resolution choice is a `fieldset` with `legend` "Resolution".
- Required reason is marked in text ("Reason, required"), not only with an asterisk.
- Moving to the next item announces "Next challenge: <code>".

## Acceptance checks

- [ ] Reject can't be submitted without a reason.
- [ ] Accept names the exact status the ballot returns to.
- [ ] Batch reject is not available.
- [ ] A concurrent resolution is detected and shown.
