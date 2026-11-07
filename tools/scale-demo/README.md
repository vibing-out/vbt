# @vbt/scale-demo (T-11)

The scale demo: 10,000 ballots across 20 precincts with a 0.5% mismatch rate, tallied and recorded per
precinct, and a mismatch report at `GET /api/reports/mismatches`.

```sh
pnpm --filter @vbt/scale-demo seed                 # dry run: the plan's counts only, no crypto, no database
pnpm --filter @vbt/scale-demo seed --yes           # build and write
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

## Crypto

Every cryptographic call goes through `CryptoAdapter` (`src/crypto-adapter.ts`). The CLI's adapter,
`realCrypto`, is `@vbt/crypto` (keys, sealed ballots, tracking codes, Merkle tree, aggregate decryption,
stage-record signatures) plus `@vbt/events` (`sha256Hex` for ciphertext hashes, `hashEvent` for the event
chain). Merkle leaves are `@vbt/events`' `stageLeaves`. So seeded ballots verify exactly like uploaded ones.
Tests use a fake adapter with readable ciphertexts, and `runSeed` accepts a non-default adapter only with a
localhost database.

## Human steps (agents can't do these)

1. Set `PRODUCT_DATABASE_URL` in Vercel (server only), or run the seed from the `seed-demo.yml` workflow on `main`.
2. With the four key variables and `PRODUCT_DATABASE_URL` in `.env.local`, run `seed --yes` once against the
   product project. The demo county can never be removed afterwards.
3. Then (the script checks the precinct exists) grant an official on the demo county, or use the state
   official: `node supabase/scripts/seed-demo-officials.ts --yes --county SCALE-DEMO --precinct SCALE-DEMO-001`.
