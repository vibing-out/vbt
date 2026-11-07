# verifier (T-15)

`vbt-verify` checks the published election record without trusting our servers. It reads only the two public `GET` endpoints (`/api/record/{scope_id}/{stage}` and `/api/track/{code}`), or a directory saved from them. It never calls a voting system, the database, the Data API or an official endpoint.

```text
vbt-verify record   --base-url <url> --county <id> --precinct <id>... [--public-key <b64>] [--json]
vbt-verify code     <tracking-code> --base-url <url> [--public-key <b64>] [--json]
vbt-verify download --base-url <url> --county <id> --precinct <id>... --out <dir>
vbt-verify record|code ... --from-dir <dir>      # offline, in place of --base-url
```

Run it with `node tools/verifier/src/cli.ts ...` (Node 24 strips the TypeScript types; there is no build step) or `pnpm --filter @vbt/verifier verify -- ...`.

## The public key

`--public-key` is the stage signing public key, base64 (32 bytes, Ed25519). It can also come from `STAGE_SIGNING_PUBLIC_KEY`. Get it from the election office, never from the server you are checking: the verifier never fetches it. With no key, every signature check fails and the run exits 1. There is no unsigned pass.

## Exit codes

`0` every check passed (some may be skipped), `1` at least one check failed, `2` usage, network or format error (nothing verified).

## Checks

`record` fetches each precinct's `TALLIED_PRECINCT` record and the county's `REPORTED_UNOFFICIAL`, `CERTIFIED`, `CHALLENGED` and `DISCARDED` records. On each it checks `signature`, `merkle-root`, `leaf-order` (ballots in strictly increasing ciphertext hash order) and `ballot-count` (the count matches and no tracking code is listed twice), then runs C2, C3 and C4. `code` checks one tracking code's `chain`, and for each proof, the stage record's `signature` and then `inclusion`.

| Check | Failure message |
| --- | --- |
| `signature` | `FAIL signature <scope_id>/<stage>: signature does not match the stage signing key` |
| `merkle-root` | `FAIL merkle-root <scope_id>/<stage>: recomputed root <r'> != published root <r>` |
| `leaf-order` | `FAIL leaf-order <scope_id>/<stage>: ballots are not sorted by ciphertext hash` / `ballots list the same ciphertext hash more than once` |
| `ballot-count` | `FAIL ballot-count <scope_id>/<stage>: ballot_count <n> != <m> ballots listed` / `<k> tracking codes are listed more than once: <first 5 codes>` |
| `c2` | `FAIL C2 <precinct>: contest <c> has <v> votes for <n> ballots` / `total <c>/<choice> is not a non-negative integer` |
| `c3` | `FAIL C3 <county>: <contest>/<choice> county total <a> != sum of precinct totals <b>` / `ballot_count <a> != sum of precinct ballot counts <b>` / `ballot set differs from its precincts by <k> codes` / `<k> tracking codes are listed more than once across precincts: <first 5 codes>` |
| `c4` | `FAIL C4 <county>: <k> ballots missing from certified with no challenge or discard: <first 5 codes>` / `<k> certified ballots are not in the unofficial record` / `<contest>/<choice> certified <a> > unofficial <b>` / `contest <c> lost <d> votes but only <k> ballots were removed` |
| `chain` | `FAIL chain <code>: first event is not CAST with a null prev_hash` / `event <i> prev_hash does not match the previous event` / `event <i> from_status does not match the previous event's to_status` |
| `inclusion` | `FAIL inclusion <code> <stage>: proof does not reach the published root` / `code not in <scope_id>/<stage>` |
| format (exit 2) | `ERROR <url>: response is not a stage record (<field> missing or wrong type)` |

A stage that is not published (404, or a missing file with `--from-dir`) prints `SKIP <scope_id>/<stage>: not published`, and the checks that need it are skipped, not failed. C4 treats an unpublished `CHALLENGED` or `DISCARDED` record as listing no ballots, so withholding one can only make C4 fail.

Output is one line per check, then a summary. `--json` prints `{checks:[{id,scope,stage,status,message}], passed}`. Lines hold tracking codes, hashes, scope ids, stage names, contest and choice ids and counts only: never a time, a leaf index, a ciphertext or a response body.

The chain check verifies linkage only. It can't recompute each event's hash yet: `packages/crypto` exports no event-hash function, and the verifier implements no hashing itself. Once it exports one (`eventHash`), the chain check adds `event <i> hash does not match its contents`.

## Crypto

All cryptography goes through `src/crypto.ts`, one adapter with the exact signatures of the `@vbt/crypto` exports on epic/4: `ready`, `isTrackingCode`, `buildMerkleTree`, `verifyInclusionProof` and `verifyStageRecord`. `packages/crypto` arrives with E3. Until then the adapter throws and the CLI exits 2 with `packages/crypto is not on this branch yet: it lands with E3`. `src/crypto.ts` explains how to wire it up. The tests inject `test/fixtures/fake-crypto.ts`, a test double that follows the same algorithms with a throwaway key.

## Saved directory

`download` writes each published, well-formed record at the path it was served from:

```text
<dir>/api/record/<scope_id>/<stage>.json
<dir>/api/track/<TRACKING-CODE>.json     read by `code --from-dir`; download does not write it
```

## Development

```sh
pnpm --filter @vbt/verifier test        # includes the 10,000-ballot run (a few seconds)
pnpm --filter @vbt/verifier typecheck
```
