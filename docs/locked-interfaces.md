> Changes to this file require Austin's or Shawn's approval, recorded as a decision in the pull request's `context-log` block.

# Locked interfaces

Every task builds against these contracts. Changing one requires Shawn's or Austin's approval and a `decision` entry in the context log. Items marked **Proposed** become locked at kickoff unless overridden.

**Approach (locked):** an end-to-end verifiable ballot tracker. The voter keeps a receipt carrying only a tracking code. Anyone can look up any code and see where that ballot is in the process and that its encrypted contents have not changed. No one, including the voter, can prove from the receipt or the public record how a ballot was voted.

## Principles (locked)

1. **Receipt-free secrecy:** receipts and public data never reveal choices; the system stores no voter identity.
2. **Public verifiability:** anyone can check any tracking code against the published record and recompute every published total.
3. **Paper is authoritative:** the voter-verified paper ballot stays in the ballot box and decides recounts; this system is an audit and transparency layer.
4. **Append-only history:** status changes are events; each event chains a hash of the previous one.
5. **No ordering leaks:** public views show the date of casting, never the time or sequence, so voters cannot be matched to ballots by order.
6. **Open code, protected data:** RLS on every table; secrets never in the repo.
7. **One-way data flow:** VVSG 2.0 requires voting systems to be air-gapped and bans wireless, so nothing connects a voting system to us. Officials export standard-format files (NIST SP 1500-101, 1500-103, 1500-100) and upload them; nothing ever flows back.

## Cryptography (Proposed)

**Decision (Nov 5):** we build a simplified encryption layer that mirrors ElectionGuard's process step for step. No ElectionGuard code runs on Saturday. The pitch says: "We use a simplified encryption layer that mirrors ElectionGuard; production would use ElectionGuard." Every step lives behind `packages/crypto` so ElectionGuard can replace it later without touching the rest of the system.

| ElectionGuard step | Our simplified version | What production ElectionGuard adds |
| --- | --- | --- |
| Election manifest | JSON manifest of contests and choices, published in the election record | Same concept |
| Key ceremony with guardians and a quorum | Single election keypair (libsodium) held by the demo officials; no key splitting in the demo (pitch only) | Distributed key generation with proofs; no single party ever holds the key |
| Ballot encryption | Sealed box to the election public key | ElGamal encryption with zero-knowledge proofs that each ballot is well-formed |
| Confirmation (tracking) code | SHA-256 of ciphertext chained to the previous code on that device, shown as readable words | Same chained-code concept |
| Cast or spoil (voter challenge) | Spoiled ballots decrypted and published so the voter can check the machine (stretch) | Same, with proofs |
| Tally | Officials decrypt in aggregate per stage; individual decrypted ballots are discarded, never published | Homomorphic tally; no individual ballot is ever decrypted |
| Election record | Signed per-stage records with Merkle roots and totals | Full election record with all proofs |
| Verifier | Our independent verifier (T-15) recomputes Merkle roots, hash chains, and totals | Independent verifiers check every proof |

## Ballot status state machine (Proposed)

| Status | Public label | Terminal |
| --- | --- | --- |
| `CAST` | Cast and sealed | No |
| `TALLIED_PRECINCT` | Counted at precinct | No |
| `REPORTED_UNOFFICIAL` | Included in election-night results | No |
| `CERTIFIED` | Included in certified results | Yes |
| `CHALLENGED` | Under review | No |
| `DISCARDED` | Not counted (reason shown) | Yes |
| `SPOILED` | Spoiled by voter to check the machine; not counted | Yes (stretch) |

| From | To | Triggered by | Batch |
| --- | --- | --- | --- |
| `CAST` | `TALLIED_PRECINCT` | Precinct close and tally | Per precinct |
| `TALLIED_PRECINCT` | `REPORTED_UNOFFICIAL` | County election-night report | Per county |
| `REPORTED_UNOFFICIAL` | `CERTIFIED` | County or state certification | Per county |
| `CAST`, `TALLIED_PRECINCT`, `REPORTED_UNOFFICIAL` | `CHALLENGED` | Official | Single |
| `CHALLENGED` | Status held before the challenge | Official resolves as accepted | Single |
| `CHALLENGED` | `DISCARDED` | Official resolves as rejected; reason required | Single |
| `CAST` | `SPOILED` | Voter spoils at the machine | Single |

Any other transition is rejected. A **mismatch** (machine record differs from the scanned paper ballot) is a flag that automatically creates a `CHALLENGED` transition.

## Event sources (Proposed)

Only cast and spoil happen to one ballot. Every later stage happens to a batch (a precinct or a county), and each ballot inherits it by membership. Real deployments get these from the election office; the hackathon simulates them.

| Stage | Real-world source in Indiana | Format | Hackathon source |
| --- | --- | --- | --- |
| Cast, spoiled | Voting machine event log; ElectionGuard record of cast and spoiled ballots | NIST SP 1500-101; ElectionGuard election record | Simulator (T-06) |
| Counted at precinct | Precinct results reported to the county election board on election night | Tabulator export, NIST SP 1500-100 | Poll-worker batch action (T-09) |
| Election-night results | County reports unofficial results to the Indiana Election Division's election night reporting site | ENR site downloads; NIST SP 1500-100 | Official batch action; optional read of a sample ENR export |
| Certified | County election board certifies its canvass and files with the Election Division | Certified returns, usually documents rather than data | Official batch action (T-09) |
| Challenged, discarded | County election board decisions, such as provisional ballots | Board minutes | Official challenge queue (T-09) |

News organizations such as AP gather results from the same county and state sources; we track the official publication, not media reports.

**Ingest is file-based (locked):** machine logs and vote records arrive as exported files uploaded by an authenticated official after polls close, never as live machine calls. The simulator (T-06) writes the same files, using VotingWorks' documented CDF log export format as the reference for machine logs.

## Cross-checks (Proposed)

No single system is trusted. At each stage, independent records must agree for each machine, precinct, or county before ballots advance; any disagreement raises a mismatch and moves the affected ballots to `CHALLENGED`.

| Source | Standard | Joins on | Holds |
| --- | --- | --- | --- |
| Machine event logs | NIST SP 1500-101 | Machine ID | Polls opened and closed, ballots counted, errors |
| Cast vote records | NIST SP 1500-103 | Ballot (officials only) | One record of choices per ballot; what ElectionGuard encrypts |
| ElectionGuard record | ElectionGuard spec | Machine ID, precinct | Encrypted ballots, tracking codes, spoiled ballots, encrypted tally |
| Official results | NIST SP 1500-100 | Precinct, county | Election-night and certified totals |

| Check | Runs at | Passes when |
| --- | --- | --- |
| C1 Machine count | Precinct tally | Ballots counted in each machine's event log = ElectionGuard ballots cast on that machine |
| C2 Precinct totals | Precinct tally | ElectionGuard tally for the precinct = precinct totals reported to the county |
| C3 Election-night totals | Election-night report | Sum of precinct totals = county's published election-night totals |
| C4 Certification | Certification | Certified totals = election-night totals, with every difference explained by a recorded challenge or discard |

**Privacy rule:** a tracking code is never linked publicly to a timestamped machine event. Machine-level timing stays official-only; the public sees dates, stages, and check results.

## Event schema (Proposed)

Table `ballot_events`, insert-only:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `ballot_id` | uuid | |
| `precinct_id`, `county_id` | text | |
| `event_type` | text | `CAST`, `STATUS_CHANGE`, `MISMATCH_DETECTED`, `CHALLENGE_RESOLVED`, `SPOILED` |
| `from_status`, `to_status` | text | Null for `CAST` |
| `actor_role`, `actor_id` | text | `machine`, `poll_worker`, `county`, `state`, `simulator` |
| `batch_id` | uuid | Null unless a batch transition |
| `reason` | text | Required for `DISCARDED` |
| `nist_event_code` | text | From NIST SP 1500-101 where applicable |
| `occurred_at`, `recorded_at` | timestamptz | Never exposed publicly beyond the date |
| `prev_hash`, `hash` | text | SHA-256 chain per ballot |

## Data model (Proposed)

| Table | Key fields |
| --- | --- |
| `precincts` | id, county_id, name |
| `machines` | id, precinct_id, vendor, model, public_key |
| `ballots` | id, tracking_code (unique), prev_tracking_code, ciphertext, ciphertext_hash, ballot_style, precinct_id, machine_id, cast_date, current_status, mismatch |
| `ballot_events` | As above |
| `batches` | id, scope (precinct or county), from_status, to_status, actor_id, created_at, ballot_count |
| `stage_records` | id, scope, stage, merkle_root, ballot_count, totals (aggregate only), published_at, signature |
| `ingest_files` (T-05) | id, sha256 (unique; SHA-256 of the uploaded file's exact bytes), kind, actor_id (uploading official), recorded_at, ballot_count. Insert-only, in the `private` schema, readable by service_role only; never exposed publicly. Added with Austin's approval on [#15](https://github.com/vibing-out/vbt/issues/15#issuecomment-6711512134) |
| sms_subscriptions (stretch, T-18) | id, tracking_code, phone_encrypted, language, created_at, expires_at (certification); deleted on STOP or certification; never exposed publicly or joined to ciphertext |

No table holds a voter's name, ID, date of birth, or signature.

## API boundaries (Proposed)

| Endpoint | Caller | Auth | Returns |
| --- | --- | --- | --- |
| `GET /api/track/{code}` | Anyone | None; rate-limited | Status, dated timeline, ciphertext hash, inclusion proof per published stage |
| `GET /api/record/{scope}/{stage}` | Anyone | None | Published record: codes, ciphertext hashes, Merkle root, totals, signature (JSON) |
| `POST /api/events` | Official uploading exported files (machine or simulator export) | Supabase Auth with MFA; file hashes recorded | Event id |
| `POST /api/batches` | Poll worker or official | Supabase Auth with MFA, role-checked | Batch id, count; publishes a stage record |
| `POST /api/challenges/{id}/resolve` | Official | Supabase Auth | New status |
| `GET /api/reports/mismatches` | Official | Supabase Auth | Mismatch list |
| `POST /api/official/demo/runs?set={id}` | State official, or county official scoped to the set's county (T-22; approved by Austin on #49) | Supabase Auth with MFA, role-checked | Streamed step results (NDJSON); 409 if the set has already run |
| POST /api/sms/inbound | SMS provider webhook | Provider signature | Reply text; handles check, TRACK, YES, STOP, HELP |

## Stack and repo layout (Proposed)

Next.js (App Router) + TypeScript, Supabase, Vercel Flags SDK, libsodium, Vitest, Playwright, k6, pnpm workspaces.

```
apps/web            Public tracker, poll-worker and official views
packages/domain     State machine, types, transition rules (no I/O)
packages/events     Event schema, hash chain, NIST mapping
packages/crypto     Ballot encryption, tracking codes, Merkle trees and proofs
packages/ui         Component library and design tokens
supabase/migrations Schema, RLS policies, seed scripts
tools/simulator     Voting machine event simulator
tools/receipts      Paper ballot and tracking-code receipt generator
tools/verifier      Independent verifier CLI for the public record
tools/demo          Judges' demo kit: seed and 3-minute timeline (T-22; approved by Austin on #49)
tests/load          k6 scripts
```

## Conventions (Proposed)

- Branches `task/T-NN-short-name`; PR titles start with the task ID.
- Every PR includes tests and passes CI before review.
- Domain logic lives only in `packages/domain`; crypto only in `packages/crypto`.
