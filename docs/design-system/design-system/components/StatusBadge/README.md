# StatusBadge

A soft pill with an icon, the status word and an optional detail (a date or a reason), never color alone.

- **Consumer provides:** the status (a stage name, or Challenged, Discarded, Spoiled), whether it is current, and an optional detail string.
- Done stages: `ink` on `stage-done`. Current stage: `.current`, `accent-text` on `accent-tint`. Waiting or in progress (admin only): `.pending`, `ink-muted` on `surface-sunk` with a clock. Off-path: `status-*` text on its `-bg` fill.
- `.plain` is for filter chips and labels that are not a status ("Uploaded tonight ×", "Signed in with MFA"): `surface-sunk`, no icon.
- Icons follow the README's fixed meanings at 16px, colored like the word. Each variant has a default: check (done), clock (pending), flag (Challenged), x-circle (Discarded, Fail, Mismatch), rotate-ccw (Spoiled). A stage badge sets its own stage's icon with `data-icon` (`lock`, `check`, `chart`, `badge-check`); an integrity result uses `shield-check`. In code, render the Lucide icon component; the preview uses CSS masks.
- The detail follows a middle dot in regular weight: "Discarded · arrived after deadline". Voter screens never put a time of day next to Cast and sealed; dates only.
- Challenged and Discarded always carry their reason, in the badge detail or in a full sentence beside it.
- Use the exact stage names in voter mode; admin tables may use the compact labels.
