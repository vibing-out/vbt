# Simulator fixtures

Copied, unmodified, from one run of the T-06 simulator at `origin/epic/4` commit `ca87bd3a7a26d2f0be84b6015b1e1804e16520bf`. No simulator code is imported: it isn't on this branch yet.

How they were made, in a throwaway worktree:

```sh
git worktree add --detach /tmp/epic4-wt ca87bd3a7a26d2f0be84b6015b1e1804e16520bf
cd /tmp/epic4-wt && pnpm install --frozen-lockfile
pnpm --filter simulator exec simulate --ballots 2 --mismatch-rate 0 --seed 1 --machines 1 --precincts 1 --out /tmp/sim-out
```

The output is deterministic, so the same command gives byte-identical files.

`git ls-tree origin/epic/4 tools/simulator/src/formats/` lists four format modules. Each one is either a NIST format with exactly one fixture here, or a simulator-private file:

| Format module | Standard | Fixture (renamed `<module>.<original name>`) | Copied from | SHA-256 |
|---|---|---|---|---|
| `cdf-log.ts` | NIST SP 1500-101 (machine event log, VotingWorks-shaped) | `cdf-log.mach-01.vx-logs.cdf.json` | `machines/mach-01/vx-logs.cdf.json` | `722bc777592f16adbb5a018ab5caf0373e88910102125c8b2eca5c368cac1648` |
| `cvr.ts` | NIST SP 1500-103 (cast vote record report) | `cvr.ballot-288fa068.cvr.json` | `cvrs/ballot-288fa068.cvr.json` | `9eecdc52548f8ba367af5332b7a920f67cafb4cb9e00d44d601012600cd42c35` |
| `manifest.ts` | none: the simulator's run manifest, not an official format | — | — | — |
| `totals.ts` | none: simulator-private totals (its README says "Not an official format") | — | — | — |

Known gap: the `cdf-log` fixture follows VotingWorks' CDF log export shape, which `docs/locked-interfaces.md` names as the reference for machine logs. That shape does **not** validate against the official NIST SP 1500-101 JSON schema. It wraps the log in `{"ElectionEventLog": ...}`, it has no `@type` on the log, devices or events, and `Sequence` is a number where the schema wants a string. `src/nist-schemas.test.ts` pins exactly these differences. When the simulator or ingest mapping (T-06 #16, T-10 #20) emits a conforming log, that test fails, and the fixture moves to the conforming list.
