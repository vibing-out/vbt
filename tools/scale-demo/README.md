# @vbt/scale-demo (T-11)

The scale demo: 10,000 ballots across 20 precincts with a 0.5% mismatch rate, tallied and recorded per
precinct, and a mismatch report at `GET /api/reports/mismatches`.

```sh
pnpm --filter @vbt/scale-demo seed                 # dry run: the plan's counts only, no crypto, no database
pnpm --filter @vbt/scale-demo seed --yes           # build and write (after E3; see below)
#   --ballots 10000 --precincts 20 --rate 0.005 --seed vbt-scale-demo   (the defaults)
```

## What one run writes

All in one transaction, as `service_role`, over a direct Postgres connection (`PRODUCT_DATABASE_URL`):

- County `SCALE-DEMO`: precincts `SCALE-DEMO-001` to `-020`, one machine each (`M-SCALE-DEMO-001-A`, ...).
- 500 ballots per precinct, cast on 2026-11-03. Tracking codes chain per machine.
- Exactly `Math.round(ballots × rate)` mismatched ballots (50 at the defaults), chosen by the seed. Each gets
  `mismatch = true`, a `MISMATCH_DETECTED` event and a `STATUS_CHANGE` `CAST → CHALLENGED`.
- Every other ballot moves `CAST → TALLIED_PRECINCT` in its precinct's batch. Each precinct gets one stage
  record (Merkle root over the sorted ciphertext hashes, aggregate totals and a signature) that leaves the
  mismatched ballots out.

The writer refuses a database that already has `SCALE-DEMO`: events and stage records are insert-only, so a
run can't be undone. It refuses to run under `CI`, and exits 1 if the run takes longer than 120 s.
Output is counts per precinct and the elapsed time only.

## Crypto: pending E3

Every cryptographic call goes through `CryptoAdapter` (`src/crypto-adapter.ts`), whose first eight methods
mirror epic/4's `@vbt/crypto` signatures. Until E3 merges, the default adapter `pendingCrypto` throws
`crypto lands with E3` from every method, so `seed --yes` fails before any connection opens and no
placeholder ciphertext or tracking code is ever written. Tests use a fake adapter, and `runSeed` accepts a
non-default adapter only with a localhost database.

The follow-up after E3 replaces `DEFAULT_CRYPTO` with `@vbt/crypto`'s `generateSigningKeyPair`,
`encryptBallot`, `computeTrackingCode`, `isTrackingCode`, `buildMerkleTree`, `aggregateDecrypt`,
`signStageRecord` and `verifyStageRecord`. `ciphertextHash` and `eventHash` have no epic/4 export yet; a
human decides which package supplies them.

## Human steps (agents can't do these)

1. After E3 merges and the adapter follow-up lands: set `PRODUCT_DATABASE_URL` in Vercel (server only).
2. With the four key variables and `PRODUCT_DATABASE_URL` in `.env.local`, run `seed --yes` once against the
   product project. The demo county can never be removed afterwards.
3. Then (the script checks the precinct exists) grant an official on the demo county, or use the state
   official: `node supabase/scripts/seed-demo-officials.ts --yes --county SCALE-DEMO --precinct SCALE-DEMO-001`.
