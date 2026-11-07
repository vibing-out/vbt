# BatchActionBar

A floating dark pill that appears when rows are selected and offers the batch transitions they allow. Every action confirms before it runs.

**Mode:** admin.

## When to use

With PrecinctTable and ChallengeQueue whenever one or more rows are selected. Hidden when nothing is selected.

## Anatomy

- Fixed at the bottom center of the content area, 24px from the bottom edge, max 720px wide.
- `surface-inverse`, `radius-pill`, `shadow-overlay`, padding `space-2` and `space-4`.
- Left: selection count in `on-inverse` weight 600 ("12 precincts selected, 4,880 ballots") and "Clear" text button.
- Right: one primary action on `brand-orange` with `on-accent` text, named for the transition ("Mark as counted"), plus secondary actions as ghost buttons in `on-inverse`.
- Disabled actions show a reason on hover and focus ("2 selected precincts have a failed check").

## Actions by stage

Actions come from the locked state machine; offer only transitions every selected row allows.

| Selected rows are at | Primary action | Transition |
| --- | --- | --- |
| Cast | Mark as counted | `CAST` to `TALLIED_PRECINCT` |
| Counted at precinct | Include in election-night results | `TALLIED_PRECINCT` to `REPORTED_UNOFFICIAL` |
| Election-night results | Certify | `REPORTED_UNOFFICIAL` to `CERTIFIED` |

## Confirmation dialog

Every action opens a dialog before anything is written.

- Title states the action and exact scope: "Mark 12 precincts as counted?"
- Body: the ballot count, the list of precincts (scrollable if long), what gets published ("A signed count record for each precinct"), and who is recorded as actor ("Recorded as: J. Rivera, County official").
- Certify is final: the body says "This can't be undone," and the confirm button stays disabled until the official types the county name.
- Buttons: "Cancel" (secondary, default focus) and the action verb repeated ("Mark as counted").
- After success: the bar hides, a toast reports "12 precincts marked as counted. 12 records published." with a link to the records, and rows update in place.
- On partial failure: list which rows failed and why; succeeded rows stay done.

## Behavior

- Slides up over `duration-base` when the first row is selected; instant under reduced motion.
- Doesn't cover the last table row: the table gets bottom padding equal to the bar height.
- Escape clears the selection when focus is in the bar.

## Accessibility

- A `region` with label "Batch actions"; count changes announced politely.
- Focus does not jump to the bar on selection; it's reachable as the next Tab stop after the table and by a skip link.
- The dialog is a modal (`role="dialog"`, `aria-modal`), traps focus, and returns focus to the bar on close.
- `focus-inverse` rings on the dark pill.

## Acceptance checks

- [ ] Only transitions valid for every selected row are enabled.
- [ ] Nothing is written until the dialog is confirmed.
- [ ] Certify requires the typed county name.
- [ ] Keyboard-only: select rows, reach the bar, confirm, return focus.
