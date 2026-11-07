# ChallengeQueue

The list of ballots waiting for an official's decision, oldest risk first, each with its reason in words.

- **Consumer provides:** challenged ballots (tracking code, precinct, reason, time waiting) and the review handler.
- `.vbt-table` in a card: tracking code in mono, precinct, reason as a StatusBadge, time waiting, and a Review button. The first row's button is primary; the rest are secondary.
- Show only what officials need to decide: the code, never anything that identifies the voter.
- Review ends in **Accept** (the ballot returns to the status it held before the challenge) or **Reject** (it becomes Discarded). Reject requires a reason in plain words, published to that ballot's public timeline.
- Empty state: "No ballots waiting. New challenges appear here when a cross-check fails."
- Pages like the PrecinctTable (50 rows, server-side), so a bad batch that challenges thousands of ballots stays usable.
