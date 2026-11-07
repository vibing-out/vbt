import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DOC = readFileSync(new URL('../../docs/factory.md', import.meta.url), 'utf8')
const DISPATCH = readFileSync(new URL('./dispatch.ts', import.meta.url), 'utf8')

// The subcommands named in dispatch.ts's USAGE line. USAGE isn't exported, so read it from the source text.
const subcommands = (source: string): string[] => {
  const usage = /const USAGE = '([^']+)'/.exec(source)?.[1] ?? ''
  const inner = usage.replace(/^usage: node dispatch\.ts </, '').replace(/>$/, '')
  return inner.split(' | ').map((part) => part.trim().split(/\s+/)[0] ?? '').filter((name) => name !== '')
}

// A subcommand counts as listed only as a code span (`name` or `name <arg>`): `check` is inside `context-check`.
const missingFrom = (doc: string, names: string[]): string[] =>
  names.filter((name) => !new RegExp('`' + name + '[` ]').test(doc))

describe('docs/factory.md', () => {
  it('is under 60 lines and names both scripts', () => {
    expect(DOC.trimEnd().split('\n').length).toBeLessThan(60)
    expect(DOC).toContain('scripts/factory/dispatch.ts')
    expect(DOC).toContain('scripts/factory/build.ts')
  })

  it('walks a ticket through check, factory-ready, the four stages and landed, in order', () => {
    const flow = DOC.slice(DOC.indexOf('## The flow'), DOC.indexOf('## `dispatch.ts` subcommands'))
    const steps = ['dispatch.ts check', 'factory-ready', 'triage', 'spec', 'implement', 'review', 'dispatch.ts landed', 'closes the ticket']
    const at = steps.map((step) => flow.indexOf(step))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('parses every subcommand from the dispatch.ts usage line', () => {
    expect(subcommands(DISPATCH)).toEqual(['check', 'landed', 'unblock', 'context-check', 'notify', 'resume'])
  })

  it('lists every dispatch.ts subcommand', () => {
    expect(missingFrom(DOC, subcommands(DISPATCH))).toEqual([])
  })

  it('fails when a subcommand is missing from the doc', () => {
    const names = subcommands(DISPATCH)
    for (const name of names) {
      const without = DOC.replace(new RegExp('`' + name + '[` ]', 'g'), '')
      expect(missingFrom(without, names)).toEqual([name])
    }
  })
})
