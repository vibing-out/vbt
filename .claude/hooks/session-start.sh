#!/usr/bin/env bash
# Prints shared team state at the start of every Claude Code session so each agent starts current.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

git fetch --quiet origin main 2>/dev/null
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
echo "Branch: $(git branch --show-current 2>/dev/null) (behind origin/main by ${behind} commits)"

if [ -f scripts/doctor.mjs ]; then
  echo
  echo "=== Setup check (npm run doctor for the full check) ==="
  node scripts/doctor.mjs --fast 2>&1 || echo "This machine has drifted from the team setup. Fix the lines marked with an x before building."
fi

echo
echo "=== docs/STATE.md ==="
cat docs/STATE.md 2>/dev/null || echo "(missing)"

echo
echo "=== Shared memory ==="
echo "Search the context log (search_context) for your task's topic before starting, and log decisions and corrections (log_context). See CLAUDE.md."

echo
echo "=== local tickets assigned to you ==="
gh issue list --assignee @me --label local --state open --limit 10 2>/dev/null || echo "(gh not available)"

echo
echo "=== Open pull requests ==="
gh pr list --state open --limit 10 2>/dev/null || echo "(gh not available)"

exit 0
