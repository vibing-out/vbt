This repository is in the middle of merging origin/main into its epic branch, because the two changed the same lines. Resolve every file listed under "Conflicted files" below. Follow CLAUDE.md.

Keep both sides' intent: main's changes are approved, and the epic's are reviewed. Where they truly contradict, keep main's and list it as a decision. Remove every conflict marker and `git add` each resolved file. Run `pnpm install`, `pnpm lint`, `pnpm typecheck` and `pnpm test`, and fix what the merge broke, staying inside the conflicted areas. Do not commit, push, abort or restart the merge, or open a pull request.

If failing checks are included below, fix them.

Finish with: each conflicted file and how you resolved it, the test results, and a list of the decisions you made.
