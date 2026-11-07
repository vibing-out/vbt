import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { queuedPull } from './merge-group.ts'

const sha = 'ec26c3e57ca3a959ca5aad62de7213c562f8c821'
const script = fileURLToPath(new URL('./merge-group.ts', import.meta.url))

describe('queuedPull', () => {
  it('reads the pull request number from a merge group head ref', () => {
    expect(queuedPull(`refs/heads/gh-readonly-queue/main/pr-61-${sha}`)).toBe(61)
  })

  it('accepts the ref without refs/heads/ and a base branch with slashes', () => {
    expect(queuedPull(`gh-readonly-queue/epic/2/pr-7-${sha}`)).toBe(7)
  })

  it.each([
    ['an ordinary branch', 'refs/heads/main'],
    ['a ticket branch named like a queue entry', `refs/heads/task/gh-readonly-queue/main/pr-1-${sha}`],
    ['a short sha', 'refs/heads/gh-readonly-queue/main/pr-61-ec26c3e'],
    ['no pull request number', `refs/heads/gh-readonly-queue/main/pr--${sha}`],
    ['an empty ref', ''],
  ])('rejects %s', (_, ref) => {
    expect(() => queuedPull(ref)).toThrow('not a merge queue ref')
  })
})

describe('command line', () => {
  it('prints the number for the workflow to pass to context-check', () => {
    const out = execFileSync('node', [script, `refs/heads/gh-readonly-queue/main/pr-61-${sha}`], { encoding: 'utf8' })
    expect(out.trim()).toBe('61')
  })

  it('exits non-zero on a ref it cannot read, so the check fails', () => {
    expect(() => execFileSync('node', [script, 'refs/heads/main'], { stdio: 'pipe' })).toThrow()
  })
})

// GitHub runs every job of a triggered workflow whose `if` allows it, so a job that doesn't name its
// event would also run on each merge queue entry. Reads job ids and their `if:` lines from the YAML text.
describe('factory.yml on merge_group', () => {
  const yaml = readFileSync(new URL('../../.github/workflows/factory.yml', import.meta.url), 'utf8')
  const jobs = [...yaml.split(/^jobs:$/m)[1]!.matchAll(/^ {2}([\w-]+):\n[\s\S]*?^ {4}if: (.+)$/gm)].map((m) => ({ id: m[1]!, cond: m[2]! }))

  it('is triggered by merge queue entries', () => {
    expect(yaml).toMatch(/^ {2}merge_group:\n {4}types: \[checks_requested\]$/m)
  })

  it('gives every job an `if` that names its event', () => {
    expect(jobs.map((j) => j.id)).toEqual(['dispatch-check', 'landed', 'unblock', 'context-check', 'notify', 'resume', 'sync-check'])
    for (const job of jobs) expect(job.cond, job.id).toContain('github.event_name ==')
  })

  it('runs only context-check on merge_group', () => {
    expect(jobs.filter((j) => j.cond.includes("'merge_group'")).map((j) => j.id)).toEqual(['context-check'])
  })
})
