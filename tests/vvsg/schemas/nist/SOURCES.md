# Vendored NIST schemas

Unmodified copies of the official NIST JSON schemas. The tests use them offline and never fetch anything. `src/nist-schemas.test.ts` checks each file's SHA-256 against this table, so an edited or replaced schema fails CI.

Only schemas that a fixture in `../../fixtures/simulator/` uses are vendored. The simulator on `origin/epic/4` writes JSON only, so no XSD is vendored yet. The NIST SP 1500-100 schema isn't vendored because no simulator format module writes election results (see `docs/vvsg-map.md`).

| File | Standard | Source URL | Last upstream commit for the file | Upstream branch tip when fetched | SHA-256 |
|---|---|---|---|---|---|
| `NIST_V0_cast_vote_records.json` | NIST SP 1500-103 (cast vote records), JSON, draft-04 | https://raw.githubusercontent.com/usnistgov/CastVoteRecords/master/NIST_V0_cast_vote_records.json | `ca637b6173127fecd2e8d9401d72a7bc0e78a654` | `master` at `6a8ff0361b6535c9befaf2a3bc405ed78aa8af40` | `f1b037e6303450b451dcf5c7a0db2ab025c5869376242ed772cb4f05b1944e89` |
| `NIST_V1_election_event_logging.json` | NIST SP 1500-101 (election event logging), JSON, draft-04 | https://raw.githubusercontent.com/usnistgov/ElectionEventLogging/master/NIST_V1_election_event_logging.json | `8ba4c33c4148fe4c1a50a79449eced40ea80b433` | `master` at `8dda82e34e54be1513619149a546d7aacff23132` | `55563d1a0d78b8a343a13e17f7d93abbac0134bce798802ad4e49e71e36ceb67` |

Fetched 2026-11-07. The 1500-103 hash matches the one recorded in `tools/simulator/vendor/nist-sp-1500-103/README.md` on `origin/epic/4`.
