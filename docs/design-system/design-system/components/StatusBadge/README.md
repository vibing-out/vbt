# StatusBadge

A compact pill naming a ballot's status: a colored dot plus the word.

**Mode:** voter and admin.

## When to use

- Voter: next to the code on the receipt pass and in lists of recently checked codes.
- Admin: in every table row that has a ballot, precinct or challenge status.

Don't use it as the main voter status; that's the headline plus StageTimeline.

## Variants

| Status | Label | Dot | Fill | Text | Icon (admin) |
| --- | --- | --- | --- | --- | --- |
| `CAST` | Cast | `ink-muted` | `surface-sunk` | `ink` | none |
| `TALLIED_PRECINCT` | Counted at precinct | `ink` | `surface-sunk` | `ink` | none |
| `REPORTED_UNOFFICIAL` | Election-night results | `accent-mark` | `accent-tint` | `ink` | none |
| `CERTIFIED` | Certified | `ink` | `stage-done` | `ink` | `check` |
| `CHALLENGED` | Under review | `status-challenged` | `status-challenged-bg` | `status-challenged` | `flag` |
| `DISCARDED` | Not counted | `status-discarded` | `status-discarded-bg` | `status-discarded` | `x` |
| `SPOILED` | Spoiled | `status-spoiled` | `status-spoiled-bg` | `status-spoiled` | `undo-2` |

## Anatomy

- `radius-pill`, padding `space-1` vertical and `space-2` horizontal, no border.
- An 8px dot, `space-1`, then the label.
- Voter size: 14px weight 600. Admin size: `small` weight 500. Exceptional statuses add their icon at 14px in place of the dot in admin tables, so the state reads without color.

## Behavior

- Static by default. When a status changes on screen, cross-fade over `duration-base`.
- Not interactive. If a row needs an action, put it elsewhere in the row.

## Accessibility

- Rendered as text, not an image: screen readers read "Status: Under review".
- The label word is always present; never collapse to the dot alone, even in dense tables.
- Every text-on-fill pair above is in `tokens.json` under `contrast.pairs` and passes 4.5:1.

## Acceptance checks

- [ ] One variant per status, labels exactly as above.
- [ ] Passes the contrast script in light and dark.
- [ ] Readable in grayscale: exceptional statuses carry their icon in admin.
- [ ] Never wraps; truncation is not allowed (the row grows instead).
