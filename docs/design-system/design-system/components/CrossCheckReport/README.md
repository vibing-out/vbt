# CrossCheckReport

Shows whether independent records agree at each stage (checks C1 to C4) and, where they don't, exactly what differs and which ballots moved to review.

**Mode:** admin. A reduced public version shows pass or fail per check and stage, with no machine-level timing.

## When to use

On the Cross-checks screen, and as the evidence panel linked from a challenge or a failed Checks cell in PrecinctTable.

## The checks

From the locked cross-check table:

| Check | Runs at | Compares |
| --- | --- | --- |
| C1 Machine count | Precinct tally | Each machine's event log count vs. encrypted ballots cast on it |
| C2 Precinct totals | Precinct tally | Encrypted tally for the precinct vs. totals reported to the county |
| C3 Election-night totals | Election-night report | Sum of precinct totals vs. the county's published totals |
| C4 Certification | Certification | Certified vs. election-night totals, every difference explained by a recorded challenge or discard |

## Anatomy

1. **Summary strip:** four cards, one per check, each `surface-raised` with `shadow-card`: check name, "Passed 311 of 312" in `heading`, a pass `check` or fail `x` with the word, and the date last run.
2. **Results table** for the selected check: one row per unit (machine, precinct or county), columns for the two compared values side by side, the difference, and the result.
   - Matching rows can be hidden with a "Show only mismatches" toggle (on by default when any fail; persists in the URL).
   - Difference column shows signed numbers ("+2") in `status-discarded` with the word "Mismatch".
3. **Mismatch detail** (expanding a row): both source files with their recorded hashes, the specific fields that differ, and the ballots moved to review with links into ChallengeQueue.

## Behavior

- Read-only. Resolving happens in ChallengeQueue.
- "Download report (CSV)" and "Download report (JSON)" for auditors.
- Rerunning a check (officials only) confirms first and shows the previous result beside the new one.

## Privacy

- The public version never shows machine IDs next to tracking codes, and never shows times, only dates.
- Admin views show machine timing only inside the mismatch detail, which requires sign-in.

## Accessibility

- Each summary card is a button that selects its check, with `aria-pressed`.
- The results table follows PrecinctTable's table rules.
- Pass and fail are words plus icons; the difference column never relies on color.

## Acceptance checks

- [ ] All four checks appear in order with pass counts.
- [ ] Every mismatch links to the ballots it moved to review.
- [ ] The public version shows no machine-level timing or machine-to-code link.
- [ ] Downloads match what the table shows.
