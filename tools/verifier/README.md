# verifier

`vbt-verify` checks one county's published stage records without trusting our servers. It reads saved record JSON files (the bodies of `GET /api/record/{scope_id}/{stage}`). It never calls a voting system, the database, the Data API or an official endpoint.

**The record format is specified in [`docs/record-format.md`](../../docs/record-format.md).** That document covers the JSON fields, how the Merkle tree is built, what the signature covers and which key verifies it, inclusion proofs, and how C2 to C4 compare totals. It is written so that you, or your own AI agent, can build a verifier from it instead of running this one. [`test/independent/check.ts`](test/independent/check.ts) is such a verifier, written only from the document with Node's built-in `crypto`. `test/independent.test.ts` shows it agrees with this tool on a seeded county and that both fail when one ciphertext hash or one stage total is altered.

```text
vbt-verify [--public-key <base64>] [--json] <record.json>...
```

Run it with `pnpm --filter @vbt/verifier verify -- ...`. That builds `@vbt/crypto` first. After that build, `node tools/verifier/src/cli.ts ...` works too, since Node 24 strips the TypeScript types.

Pass every `TALLIED_PRECINCT` record of the county, and whichever of its `REPORTED_UNOFFICIAL`, `CERTIFIED`, `CHALLENGED` and `DISCARDED` records are published. Records of more than one county are a usage error.

## The public key

`--public-key` is the stage signing public key: 32 bytes, Ed25519, base64. It can also come from `STAGE_SIGNING_PUBLIC_KEY`. **Get it from the election office, never from the server you are checking.** The verifier never fetches it. With no key, every signature check fails and the run exits 1. There is no unsigned pass.

## Checks

For each record: `ballot-count`, `leaf-order`, `merkle-root` and `signature`. Then `c2` on each precinct record, `c3` when the unofficial record is given, and `c4` when the unofficial and certified records are given (record-format §9 and §10). Output is one `PASS` or `FAIL` line per check and a summary. `--json` prints `{checks:[{check,scope_id,stage,ok,failures}], passed}`. Lines hold check ids, scope ids, stages, contest and choice ids, counts and at most five tracking codes. They never hold a time, a leaf position or a ciphertext.

Exit codes: `0` every check passed, `1` at least one check failed, `2` usage or format error (nothing verified).

## How it is built

All cryptography is `@vbt/crypto` (`buildMerkleTree`, `verifyInclusionProof`, `verifyStageRecord`), and leaves and their order are `@vbt/events` `stageLeaves`. That is the same code that writes the records (`POST /api/batches` and the scale-demo seed). The tool itself hashes and signs nothing.

This is the minimal verifier added with T-15a on the epic branch, where the T-15 verifier on `main` had not arrived yet. The T-15 verifier also reads the public endpoints over HTTP and checks event chains. It follows the T-15 draft of the record shape, which differs from what the producers write: see "Differences from the T-15 draft" in `docs/record-format.md`.

## Development

```sh
pnpm --filter @vbt/verifier test
pnpm --filter @vbt/verifier typecheck
```
