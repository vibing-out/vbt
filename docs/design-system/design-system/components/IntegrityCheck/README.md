# IntegrityCheck

Shows that a ballot's encrypted contents are unchanged and included in each published stage record, with the proof one tap away.

**Mode:** voter (and the public verifier view).

## When to use

On the tracker, under the hero card. One row per published stage the ballot has reached.

## Anatomy

A `surface-raised` card, `shadow-card`, titled "Proof" with a `shield-check` icon.

Each row:

1. Result icon: `check` in `ink` (pass) or `x` in `status-discarded` (fail).
2. Plain sentence in `body-lg`: "Your encrypted ballot is unchanged and included in Precinct 12's count record."
3. Date of the record in `ink-muted`.
4. Disclosure button: "See the proof".

Expanded proof (a disclosure, not a new page):

- Ciphertext hash, Merkle root and record signature in `code` style, each truncated in the middle (`5447…d3d0`) with a copy button that copies the full value.
- "Download this record (JSON)" with a `download` icon.
- "Check it yourself" link to the verifier instructions.
- One sentence on what this proves: "This shows your ballot hasn't changed since it was sealed. It can't show how you voted, to anyone."

## States

| State | Treatment |
| --- | --- |
| Verifying | Row shows "Checking..." with a muted icon; never a long spinner |
| Pass | As above |
| Fail | `status-discarded-bg` callout: "This record doesn't match. We've flagged it for county review." plus the specific check that failed and a link to report it. Never alarmist, never vague. |
| Not yet published | Upcoming stages show "Published after election-night results" in `ink-muted`, no icon |

## Behavior

- Verification runs in the browser against the published record, so the claim is the voter's own check, not our word.
- Expanding a row loads nothing new if the record is already fetched.

## Accessibility

- Each row is a `li` in a list; the disclosure uses `button` with `aria-expanded` and `aria-controls`.
- Pass and fail are words, not just icons ("Passed", "Failed" as visually hidden text before the sentence).
- Hashes are announced as "hash, starts 5447, ends d3d0"; full value available via copy.

## Acceptance checks

- [ ] One row per reached published stage, in stage order.
- [ ] Failure state shows which check failed and what happens next.
- [ ] Copy buttons copy the full untruncated value.
- [ ] Downloaded JSON is the same file `GET /api/record/{scope}/{stage}` returns.
