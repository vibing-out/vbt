import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The pull request a merge-queue entry tests, read from the merge group's head ref.
//   node scripts/factory/merge-group.ts <head_ref>   prints the pull request number
// GitHub names each entry's ref gh-readonly-queue/<base>/pr-<number>-<head sha>, one per queued pull
// request even when several are tested together, so every pull request in a group gets its own run.
// factory.yml runs `context-check` on that number, so the body is checked again at merge time:
// `landed` logs the context-log block from the body as it is when the pull request merges.

const QUEUE_REF = /^(?:refs\/heads\/)?gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]{40}$/

export function queuedPull(headRef: string): number {
  const match = QUEUE_REF.exec(headRef)
  if (!match) throw new Error(`not a merge queue ref: ${headRef}`)
  return Number(match[1])
}

// import.meta.main is missing on some Node versions (see report.ts), where the CLI would silently
// do nothing. Fall back to comparing the module URL with the resolved script path.
const isMain = import.meta.main ?? (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)

if (isMain) {
  try {
    console.log(queuedPull(process.argv[2] ?? ''))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
