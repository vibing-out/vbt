# PrecinctTable

The main admin surface: every precinct (or county) with its ballot counts by status, check results and selection for batch actions.

**Mode:** admin.

## When to use

On the Precincts screen for poll workers and county officials. Rows are precincts for a county official, counties for a state official.

## Columns

| Column | Content | Align | Sortable |
| --- | --- | --- | --- |
| Select | Checkbox | center | no |
| Precinct | Name, with ID in `code` style below in `ink-muted` | left | yes |
| Stage | StatusBadge of the precinct's current batch stage | left | yes |
| Ballots | Total count | right | yes |
| By status | Small counts: cast, counted, reported, certified | right | no |
| Exceptions | Under review and not counted counts, each with its StatusBadge icon; blank when zero | right | yes |
| Checks | C1 to C4 result: `check` pass, `x` fail with the word, or "Pending" | left | yes |
| Updated | Date only | right | yes |

Numbers use `tabular-nums`. Zero shows as "0" in counts, blank in Exceptions.

## Anatomy

- `surface-raised` container, `radius-sm`, `shadow-card`.
- Header row on `surface-sunk`, sticky, `label` style.
- 44px rows, `line` dividers, `small` text; hover and selected rows tint with `surface-sunk`.
- Filter chips above: Stage, Exceptions, Checks, plus a search box by name or ID. Active chips show their value and a clear button.
- Count line above the table: "Showing 24 of 312 precincts".

## Behavior

- **Filters and sort persist in the URL** query string (`?stage=TALLIED_PRECINCT&checks=failed&sort=-ballots`). Reloads, back and shared links restore them.
- Selecting any row raises the BatchActionBar. The header checkbox selects all rows matching the current filter, and says so: "Select all 24 matching".
- Only rows eligible for the same next transition can be batch-advanced together; the bar explains if a mix is selected.
- Rows with a failed check can be selected but not advanced; the bar shows why.
- Clicking a precinct name opens its detail (ballots, events, check evidence) in a side drawer, keeping the table and selection.
- Live updates change counts in place without reordering rows under the pointer.

## States

| State | Treatment |
| --- | --- |
| Loading | Skeleton rows matching column widths |
| Empty filter | "No precincts match these filters." with "Clear filters" |
| Error | Inline callout above the table with retry; keep the last good data visible |

## Accessibility

- A real `table` with `th scope="col"`, `caption` (visually hidden) naming the county and filters.
- Sortable headers are buttons with `aria-sort`.
- Row checkboxes have accessible names: "Select Precinct 12".
- Arrow-key navigation is not required; Tab order is header controls, then each row's checkbox and link.

## Acceptance checks

- [ ] Filter and sort survive a reload and a copied link.
- [ ] "Select all matching" selects only filtered rows and states the count.
- [ ] Mixed or failed-check selections can't be advanced, with a reason shown.
- [ ] Usable at 1024px without horizontal scroll; wider columns hide in a defined order below that.
