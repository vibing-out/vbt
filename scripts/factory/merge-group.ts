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

if (import.meta.main) {
  try {
    console.log(queuedPull(process.argv[2] ?? ''))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
