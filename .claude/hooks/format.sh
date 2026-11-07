#!/usr/bin/env bash
# Formats each file an agent edits, so both machines produce identical diffs.
# No-op until Biome is installed in the repo.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -x node_modules/.bin/biome ] || exit 0

file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input?.file_path??"")}catch{}})')
[ -n "$file" ] && [ -f "$file" ] || exit 0

node_modules/.bin/biome format --write --no-errors-on-unmatched "$file" >/dev/null 2>&1
exit 0
