import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check, render, summary } from './report.ts'

// A complete review report: PR #46's round 2, written in the required format.
const example = readFileSync(new URL('./report.example.md', import.meta.url), 'utf8')
const swap = (from: string, to: string) => example.replace(from, to)
const openFix = swap('1. [high, fixed] Base tables', '1. [high, open] Base tables')

describe('check', () => {
  it('accepts the example and derives a clean verdict', () => {
    expect(check(example, 'review')).toMatchObject({ errors: [], verdict: 'clean', failed: 0 })
  })

  it('derives "fixes needed" from an open unambiguous fix', () => {
    expect(check(openFix, 'review').verdict).toBe('fixes needed')
  })

  it('derives "approver decisions" from an open judgment call alone', () => {
    const body = swap('#### Judgment calls for a human\nnone', '#### Judgment calls for a human\n- [medium, open] Keep Indiana time for the demo?')
    expect(check(body, 'review')).toMatchObject({ errors: [], verdict: 'approver decisions' })
  })

  it('reports each missing section', () => {
    const body = example.replace(/### QA performed[\s\S]*?(?=### Security)/, '')
    expect(check(body, 'review').errors).toContain('missing section "### QA performed"')
  })

  it('rejects sections out of order', () => {
    const tests = /### Tests\n[\s\S]*?(?=### QA performed)/.exec(example)![0]
    const body = example.replace(tests, '').replace('### Security and locked interfaces', `${tests}### Security and locked interfaces`)
    expect(check(body, 'review').errors).toContain('sections must be in this order: What was checked, Tests, QA performed, Security and locked interfaces, Findings, Decisions, Summary')
  })

  it('requires a result and evidence for every criterion', () => {
    const errors = check(swap('| 3. Event hashes are publicly readable | pass |', '| 3. Event hashes are publicly readable | looks fine |'), 'review').errors
    expect(errors).toContain('What was checked: result must be pass, fail or unverified, not "looks fine" (3. Event hashes are publicly readable)')
    const noEvidence = example.replace(/\| 8\. Publishing a stage record is an insert \| pass \| .*\|/, '| 8. Publishing a stage record is an insert | pass | |')
    expect(check(noEvidence, 'review').errors).toContain('What was checked: no evidence for "8. Publishing a stage record is an insert"')
  })

  it('requires test counts or an explicit "Not run:"', () => {
    const tests = /### Tests\n[\s\S]*?(?=### QA performed)/
    expect(check(example.replace(tests, '### Tests\n- All tests pass.\n\n'), 'review').errors)
      .toContain('Tests: give counts from what ran (for example "111 passed, 0 failed"), or a "Not run:" line saying why')
    expect(check(example.replace(tests, '### Tests\n- Not run: CI had not finished after 7 minutes.\n\n'), 'review').errors).toEqual([])
  })

  it('requires every finding to carry severity and status', () => {
    const errors = check(swap('1. [high, fixed] Base tables', '1. Base tables'), 'review').errors
    expect(errors.some(e => e.startsWith('Findings > Unambiguous fixes: tag this item [high|medium|low, open|fixed]'))).toBe(true)
  })

  it('requires both finding groups for a review', () => {
    expect(check(swap('#### Judgment calls for a human\nnone\n', ''), 'review').errors).toContain('Findings: missing "#### Judgment calls for a human"')
  })

  it('rejects a failed criterion with no open finding', () => {
    const errors = check(swap('| 3. Event hashes are publicly readable | pass |', '| 3. Event hashes are publicly readable | fail |'), 'review').errors
    expect(errors).toContain('a criterion failed but no finding is open: add the open finding that fixes it')
  })

  it('requires decisions as {"text": ...} lines', () => {
    expect(check(swap('{"text": "Moving', '{"note": "Moving'), 'review').errors.some(e => e.startsWith('Decisions: each line must be {"text": "..."}'))).toBe(true)
    expect(check(example.replace(/### Decisions\n.*\n/, '### Decisions\nnone\n'), 'review').errors).toEqual([])
  })

  it('requires 3 to 5 summary bullets', () => {
    const body = example.replace(/### Summary[\s\S]*$/, '### Summary\n- Looks good.\n')
    expect(check(body, 'review').errors).toContain('Summary: write 3 to 5 bullets, not 1')
  })

  it('checks a verification report without decisions or finding groups', () => {
    const body = example
      .replace(/### Decisions\n.*\n\n/, '')
      .replace(/#### Unambiguous fixes\n/, '')
      .replace(/\n#### Judgment calls for a human\nnone\n/, '')
    expect(check(body, 'verify')).toMatchObject({ errors: [], verdict: 'pass' })
    expect(check(body.replace('1. [high, fixed]', '1. [high, open]'), 'verify').verdict).toBe('fail')
    expect(check(example, 'verify').errors).toContain('unexpected section "### Decisions"')
  })
})

describe('render', () => {
  const run = 'https://platform.warp.dev/5UtMcqD5xE2zDbegRaz6mi/runs/abc'
  const models = 'CLAUDE_MODELS=claude-opus-5-5 AUTH=subscription-oauth (API keys unset)'

  it('puts the derived verdict, models, counts and run link around the body', () => {
    const { errors, comment } = render(openFix, { kind: 'review', title: 'Review round 1', models, run })
    expect(errors).toEqual([])
    expect(comment.split('\n').slice(0, 5)).toEqual(['## Review round 1: fixes needed', '', models, '', 'Findings: 1 open, 1 fixed. Criteria failed: 0.'])
    expect(comment.trimEnd().endsWith(`Warp run: ${run}`)).toBe(true)
    expect(comment).toContain(openFix.trim())
  })

  it('refuses an incomplete report or a review without its models line', () => {
    expect(render(example, { kind: 'review', title: 'Review round 2', run }).errors).toEqual(['--models must be the CLAUDE_MODELS= line review printed'])
    const bad = render(example.replace(/### Summary[\s\S]*$/, ''), { kind: 'review', title: 'Review round 2', models, run })
    expect(bad).toEqual({ errors: ['missing section "### Summary"'], comment: '' })
  })

  it('posts only the report when the caller passes its wrapper lines too', () => {
    // T-20's review round 1 (pull request #55): the Foreman passed the Review agent's whole message, header and all.
    const leaked = readFileSync(new URL('./report.t20-round1.md', import.meta.url), 'utf8')
    expect(leaked.startsWith('Claude review')).toBe(true)
    const { errors, comment } = render(`${leaked}\nREPORT_CHECK: passed\n`, { kind: 'review', title: 'Review round 1', models, run })
    expect(errors).toEqual([])
    expect(comment.match(/CLAUDE_MODELS=/g)).toHaveLength(1)
    expect(comment).not.toMatch(/Claude review|REPORT_CHECK|usage:/)
    expect(comment).toMatch(/Criteria failed: 0\.\n\n### What was checked\n/)
    expect(comment.trimEnd().endsWith(`Warp run: ${run}`)).toBe(true)
  })

  it('leaves out the run line when there is no run', () => {
    expect(render(example, { kind: 'review', title: 'Review round 2', models }).comment).not.toContain('Warp run:')
  })
})

describe('summary', () => {
  it('returns only the Summary bullets of a rendered comment, not the run link after them', () => {
    const { comment } = render(example, { kind: 'review', title: 'Review round 2', models: 'CLAUDE_MODELS=claude-opus-5-5', run: 'https://platform.warp.dev/x/runs/1' })
    expect(summary(comment).split('\n')).toHaveLength(4)
    expect(summary(comment)).toMatch(/^- Closes T-04's public-surface gaps/)
  })
})
