# BatchActionBar

A floating dark pill that appears when officials select ballots, followed by a confirmation dialog before anything is published.

- **Consumer provides:** the selected count, the batch total and scope, the one next-stage action, and the publish handler.
- **Pill** (`.vbt-fab`, `surface-inverse`, `radius-pill`, `shadow-overlay`), floating centered above the table: clear button, "1,284 selected" in tabular numbers, a thin divider, "Select all 4,210 in Precinct 12", the orange action named for the stage it sets, and a more menu.
- **Dialog** (`.vbt-dialog`, `radius-lg`): icon circle on `accent-tint`, a question as the title, one sentence on what becomes public, a summary block (ballots, new stage, record), a typed confirmation of the batch name, then Cancel and "Publish record".
- Exactly one primary action, never "Submit" or "Approve". The dialog is part of the page, not a browser dialog.
- After publishing, replace the pill with a result toast linking to the signed record. History is append-only; corrections are new records.
