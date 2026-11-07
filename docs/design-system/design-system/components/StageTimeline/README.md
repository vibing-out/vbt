# StageTimeline

A ballot's four stages in three forms: the hero card at the top of the tracker, the history list under it, and a compact segmented bar for admin rows.

- **Consumer provides:** the four stages in fixed order, each with state (`done`, `current`, `upcoming`) and a date; one plain-language headline and next-step sentence for the current stage; the tracking code; the last-updated time.
- **Hero card** (`.vbt-hero`, `surface-inverse`, `radius-lg`): eyebrow with county, precinct and "Updated" time; the current stage as a 30px headline; one sentence naming the next step; a rail of four 40px icon circles (done: `on-inverse`, current: `brand-orange` with a halo, upcoming: outlined); the code in a copyable chip. Modeled on a lock-screen Live Activity.
- **History list** (`.vbt-history` in a `.vbt-card`): one row per stage with a 36px icon circle and date; the current row sits on `accent-tint` and carries the note. Cards separate by `shadow-card`, never borders.
- **Compact bar** (`.vbt-seg`): four segments, done `ink`, current `accent-mark`, upcoming `surface-sunk`, short labels below. For admin tables and dense views.
- Mark the current stage with `aria-current="step"`; give each rail circle an accessible name with its state.
- Challenged, discarded or spoiled: stop at the last completed stage and show a StatusBadge with the reason under the headline. Never color a stage red.
- When a batch lands, animate only the newly completed circle filling (200ms); none under reduced motion.
- **Never show when a ballot was cast.** Stages show dates only, never a time of day for Cast and sealed, and nothing that reveals casting order. "Updated 9:42 PM" is fine: it's when an official's batch landed, the same for every ballot in it.
