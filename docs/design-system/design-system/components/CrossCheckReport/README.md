# CrossCheckReport

The timestamped log of every cross-check a batch runs: what passed, what failed, and exactly which ballots a failure affected.

- **Consumer provides:** check results in order (time, plain-language description, pass or fail, affected ballot count, explanation for a failure).
- `.vbt-log` in a card: mono timestamps, one sentence per check with real counts ("matches 1,284 of 1,284"), a StatusBadge on the right.
- A failure row sits on `status-challenged-bg` and adds one line saying what happened and that only the affected ballots moved to Challenged.
- Checks use the playbook's IDs and wording: **C1 Machine count** (ballots in each machine's log = encrypted ballots cast on it), **C2 Precinct totals** (encrypted tally = precinct totals reported), **C3 Election-night totals** (sum of precincts = county's published totals), **C4 Certification** (certified totals = election-night totals, every difference explained). Signature validity and the published, hash-chained record show as rows around them.
- Machine-level timestamps are official-only. Never show them on a public screen.
- This is also the mismatch report: link each failure to its ballots in the ChallengeQueue.
