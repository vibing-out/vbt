# VBT: Verifiable Ballot Tracking

**Track your ballot like a package, and prove it was counted without trusting us.**

Live at **[www.ballottrack.org](https://www.ballottrack.org)** · Built in one day at Indy Init 2026

VBT gives every voter a tracking code on their receipt. Scan it and watch the ballot move from Cast to
Counted at precinct to Certified, or see exactly why it was challenged or not counted. Every stage of the
count publishes a signed record, so anyone can check that their encrypted ballot is unchanged and included,
without learning how anyone voted.

## Try it

| What | Where |
|---|---|
| Track a ballot | [/track](https://www.ballottrack.org/track) |
| Printable demo receipts (one per outcome, scan with your phone) | [/demo-receipts](https://www.ballottrack.org/demo-receipts) |
| A seeded ballot verified against its signed record | [/track/FIND-TOAST-49FN-PHYSICAL](https://www.ballottrack.org/track/FIND-TOAST-49FN-PHYSICAL) |
| The public election record (20 signed precinct records) | [/record](https://www.ballottrack.org/record) |
| Official tools (password plus authenticator code) | [/login](https://www.ballottrack.org/login) |
| Component gallery | [/gallery](https://www.ballottrack.org/gallery) |

## How it protects the count

- **Encrypted ballots.** Each ballot is sealed with libsodium sealed boxes. Only aggregate totals are ever decrypted.
- **Signed public records.** Each stage publishes a Merkle root over every ballot's ciphertext hash, signed with
  Ed25519. Changing one ballot breaks the root, and a test proves it.
- **Append-only history.** Ballot events and stage records reject updates and deletes, and each event chains
  the previous event's hash.
- **No voter identity, no ordering leaks.** No name, ID or phone sits next to a tracking code, and public views
  show the date of casting, never the time.
- **One-way data flow.** Nothing calls out to a voting system. Data enters only through an authenticated
  official's file upload, and an air-gap test enforces it.
- **Officials need two-factor sign-in.** Every official route checks role and MFA. Row-level security is on
  every table.
- **Check it yourself.** `tools/verifier` rebuilds the records offline; its independent checker uses only
  `node:crypto`. The format is documented in [docs/record-format.md](docs/record-format.md).

## Repo layout

```text
apps/web           Next.js app: voter tracker, public record, official tools
packages/domain    Ballot state machine and cross-checks
packages/crypto    Sealed boxes, Merkle trees, stage-record signatures
packages/events    Event hashing and stage leaves
packages/ui        Design system components (shadcn base, our tokens)
supabase/          Migrations, row-level security, seed
tools/simulator    Voting machine simulator (NIST SP 1500-103 vote records, VotingWorks-style logs)
tools/verifier     Independent record verifier
tools/scale-demo   10,000-ballot seed with injected mismatches
tools/demo         Judges' 3-minute demo kit
tools/receipts     Paper ballot and receipt generator
tests/load         k6 load test for election-night lookups
tests/vvsg         VVSG 2.0 alignment and air-gap tests
```

## Run it locally

```sh
nvm use            # Node 24
pnpm install
pnpm doctor        # checks your setup
pnpm dev           # apps/web on localhost
pnpm test && pnpm typecheck && pnpm lint
```

Environment variables are listed in [.env.example](.env.example).

## How we built it

Two people and a fleet of AI agents built VBT in one day. GitHub issues were the backlog: epics as parent
issues, tickets as sub-issues with blockers. A Warp factory picked up each ready ticket, implemented it, ran
an automated Claude Code review, applied one fix pass, and auto-merged it into its epic branch. Local Claude
Code sessions took tickets labeled `local` and handled merge conflicts. **A human approved every merge into
`main`.**

By the end of the day (counted from the GitHub and Warp records):

- 96 pull requests merged: 52 into `main`, 43 into epic branches
- 33 factory tasks, with 29 automated review rounds
- `needs-human` raised 44 times; a person answered and the factory resumed

Every pull request ends with a `context-log` block. Decisions and AI corrections, the places the AI was
wrong and how it was caught, go into a shared, insert-only log that later tickets read before they start.

**Stack:** Next.js (App Router), TypeScript, Supabase, Vercel and the Vercel Flags SDK, libsodium, Vitest,
Playwright, k6, pnpm workspaces.

## Docs

- [Locked interfaces](docs/locked-interfaces.md): the contract every ticket builds against
- [Record format](docs/record-format.md): how to verify a published record yourself
- [Voter journey](docs/voter-journey.md)
- [NIST mapping](docs/nist-mapping.md) and [VVSG map](docs/vvsg-map.md)
- [Design system](docs/design-system/README.md)
- [Project state and ownership](docs/STATE.md)

## License

[MIT](LICENSE)
