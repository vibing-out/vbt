import { describe, expect, it } from 'vitest'
import { runContext } from './dispatch.ts'
import {
  BODY_LIMIT, NOTES_END, NOTES_START, approverItems, contextLog, delivered, epicRollup, keptNotes, previewUrl, quote, reviewRounds, runLinks,
  type RollupInput, type RollupTicket,
} from './rollup.ts'

const block = (decisions: string[], corrections: { claim: string; fix: string; detected_by: string }[] = []): string =>
  ['```context-log', JSON.stringify({ version: 1, decisions: decisions.map((text) => ({ text })), corrections }), '```'].join('\n')

// Shaped like the factory's real pull request bodies (#37, #44, #55).
const domainPr = [
  'Ticket: #11',
  '',
  '## Summary',
  'Implements T-02: the ballot status state machine.',
  '',
  '## Review log',
  '### Round 1 (Claude Code)',
  '- **Finding:** statuses not frozen — **fixed**.',
  '- **Judgment (not blocking):** DISCARDED reason is free text shown to voters.',
  '### Round 2 (Claude Code)',
  '- Clean.',
  'Warp run: https://platform.warp.dev/5UtMcqD5xE2zDbegRaz6mi/runs/abc-123',
  '',
  block(['Statuses are frozen at runtime'], [{ claim: 'Statuses were mutable', fix: 'Object.freeze', detected_by: 'code reviewer' }]),
].join('\n')
const authPr = [
  'Ticket: #13',
  '',
  '## Summary',
  '',
  'Officials sign in with MFA; ask @hoosierplew | see `whoami`.',
  '',
  '## Review log',
  '### Rounds',
  '1. **fixes needed** — bypass header.',
  '2. **clean**.',
  '### For the epic approver',
  '1. Approve `official_roles` as a locked-interface addition.',
  '2. Run seed:demo-officials after merging.',
  'Run: https://github.com/vibing-out/vbt/actions/runs/42401485203',
  '',
  block(['requireRole always demands aal2']),
].join('\n')

const ticket = (overrides: Partial<RollupTicket> & Pick<RollupTicket, 'number' | 'title'>): RollupTicket => ({
  state: 'CLOSED',
  labels: [],
  body: '',
  pulls: [],
  ...overrides,
})
const input = (overrides: Partial<RollupInput> = {}): RollupInput => ({
  epic: { number: 2, title: 'E1 Foundation', body: '### Outcome\n\nA hello-world page deploys.\n\n### Review focus\n\n- RLS on every table.\n- No secrets.\n' },
  tickets: [
    ticket({ number: 11, title: 'T-02 Domain', body: '### How to verify in the browser\n\nOpen /status and see 7 statuses.', pulls: [{ number: 37, url: 'u37', body: domainPr, runs: runLinks(domainPr) }] }),
    ticket({ number: 13, title: 'T-20 Auth', pulls: [{ number: 55, url: 'u55', body: authPr, runs: [] }] }),
    ticket({ number: 15, title: 'T-05 Scanner', state: 'OPEN', labels: ['needs-human'] }),
  ],
  pull: { number: 39, headSha: 'ed4e88e0000000000000000000000000000000000' },
  previewUrl: 'https://vbt-git-epic-2-vvpat.vercel.app',
  previousBody: '',
  ...overrides,
})

describe('roll-up parts', () => {
  it('reads what a pull request delivered from its Summary, skipping the Ticket line', () => {
    expect(delivered(domainPr)).toBe('Implements T-02: the ballot status state machine.')
    expect(delivered('Ticket: #9\n\nNo headings here.\n\nMore.')).toBe('No headings here.')
    expect(delivered('## Summary\nShips the simulator:\n\n- CVR files\n- logs\n- totals\n- faults')).toBe('Ships the simulator: CVR files; logs; totals; …')
    expect(delivered('## Summary\n- First item\n- Second')).toBe('First item')
  })
  it('counts review rounds in both formats the factory writes', () => {
    expect(reviewRounds(domainPr)).toBe(2)
    expect(reviewRounds(authPr)).toBe(2)
    expect(reviewRounds('## Summary\nNo review.')).toBe(0)
  })
  it('collects approver items and judgment calls', () => {
    expect(approverItems(domainPr)).toEqual(['DISCARDED reason is free text shown to voters.'])
    expect(approverItems(authPr)).toEqual(['Approve `official_roles` as a locked-interface addition.', 'Run seed:demo-officials after merging.'])
    // As #35 writes them: a judgment bullet introducing nested items, and one with its text inline.
    const nested = '## Review log\n- **Judgment (left for epic approver):**\n  - Ballot id in CDF details\n  - Fault detail may embed a choice\n- Fixed: schema.\n- **Judgment (epic approver):** spot-check the schema.'
    expect(approverItems(nested)).toEqual(['Ballot id in CDF details', 'Fault detail may embed a choice', 'spot-check the schema.'])
  })
  it('reads decisions and corrections from the context-log block, and nothing from a broken one', () => {
    expect(contextLog(domainPr)).toEqual({
      decisions: ['Statuses are frozen at runtime'],
      corrections: [{ claim: 'Statuses were mutable', fix: 'Object.freeze', detectedBy: 'code reviewer' }],
    })
    expect(contextLog('```context-log\n{oops\n```')).toEqual({ decisions: [], corrections: [] })
  })
  it('finds Warp and Actions run links', () => {
    expect(runLinks(domainPr + authPr)).toEqual([
      'https://platform.warp.dev/5UtMcqD5xE2zDbegRaz6mi/runs/abc-123',
      'https://github.com/vibing-out/vbt/actions/runs/42401485203',
    ])
  })
  it('quotes text on one line with mentions defused, pipes escaped and fences removed', () => {
    expect(quote('ask @hoosierplew\n| ```x```')).toBe('ask &#64;hoosierplew \\| x')
    expect(quote('adds `@vbt/crypto` for @shawn')).toBe('adds `@vbt/crypto` for &#64;shawn')
    expect(quote('a'.repeat(20), 10)).toBe(`${'a'.repeat(9)}…`)
  })
  it('takes the preview URL only from a Vercel comment', () => {
    expect(previewUrl([{ author: 'someone', body: 'https://evil.vercel.app' }])).toBeNull()
    expect(previewUrl([{ author: 'vercel[bot]', body: '[Preview](https://VBT-git-epic-2-vvpat.vercel.app)' }])).toBe('https://vbt-git-epic-2-vvpat.vercel.app')
  })
})

describe('epicRollup', () => {
  const body = epicRollup(input())

  it('has every section, in order, with the context-log block last', () => {
    const headings = body.split('\n').filter((l) => l.startsWith('#'))
    expect(headings).toEqual([
      '# E1 Foundation',
      '## Tickets',
      '## Decisions made',
      '## Corrections caught by review',
      '## For the epic approver',
      '## How to test it',
      '### Review focus (from #2)',
      '## Risks',
      '## Run links',
      '## Notes',
    ])
    expect(body.startsWith('Closes #2\n')).toBe(true)
    expect(body.trimEnd().endsWith('```context-log\n{"version": 1, "decisions": [], "corrections": []}\n```')).toBe(true)
  })
  it('passes the context-log check that context-check runs', async () => {
    await expect(runContext(['check'], body)).resolves.toMatch(/valid/)
  })
  it('states the outcome, status, preview and head', () => {
    expect(body).toContain('A hello-world page deploys.')
    expect(body).toContain('**Status:** 2 of 3 tickets merged into `epic/2`; 1 open, 1 waiting on a person. **Preview:** https://vbt-git-epic-2-vvpat.vercel.app. **Head:** `ed4e88e`.')
  })
  it('lists each ticket with its pull requests and review rounds', () => {
    expect(body).toContain('| #11 T-02 Domain | #37 | Implements T-02: the ballot status state machine. | 2 |')
    expect(body).toContain('| #13 T-20 Auth | #55 | Officials sign in with MFA; ask &#64;hoosierplew \\| see `whoami`. | 2 |')
    expect(body).toContain('| #15 T-05 Scanner | — | In progress | — |')
  })
  it('lists decisions, corrections, approver items, flows, risks and run links', () => {
    expect(body).toContain('- Statuses are frozen at runtime (#37)')
    expect(body).toContain('- Statuses were mutable → Object.freeze (caught by code reviewer, #37)')
    expect(body).toContain('- Approve `official_roles` as a locked-interface addition. (#55)')
    expect(body).toContain('- **#11 T-02 Domain:** Open /status and see 7 statuses.')
    expect(body).toContain('- [ ] RLS on every table.')
    expect(body).toContain('- #15 T-05 Scanner is still open and waits on a person (`needs-human`).')
    expect(body).toContain('- #37: [run 1](https://platform.warp.dev/5UtMcqD5xE2zDbegRaz6mi/runs/abc-123)')
    expect(body).toContain('- The 3 approver item(s) above are undecided until someone answers them.')
  })
  it('drops template footers and "None" from the browser checks', () => {
    const t = (n: number, verify: string) => ticket({ number: n, title: `T-${n}`, body: `### How to verify in the browser\n\n${verify}\n\n---\n_Generated by a bot_` })
    const out = epicRollup(input({ tickets: [t(1, 'Open /tracker.'), t(2, 'None (no screen).')] }))
    expect(out).toContain('- **#1 T-1:** Open /tracker.\n')
    expect(out).not.toContain('#2 T-2:**')
    expect(out).not.toContain('Generated by')
  })
  it('never mentions anyone', () => {
    expect(body).not.toMatch(/@[A-Za-z0-9]/)
  })
  it('keeps hand-written notes across refreshes', () => {
    const notes = `${NOTES_START}\nShawn: demo on the big screen.\n${NOTES_END}`
    const refreshed = epicRollup(input({ previousBody: `old text\n${notes}\nmore` }))
    expect(keptNotes(refreshed)).toBe(notes)
  })
  it('renders an epic with no tickets yet', () => {
    const empty = epicRollup(input({ tickets: [], previewUrl: null, epic: { number: 3, title: 'E2 Design', body: '' } }))
    expect(empty).toContain('**Status:** No tickets yet. **Preview:** not deployed yet.')
    expect(empty).toContain('The epic issue #3 has no Outcome section yet.')
  })
  it('refuses a body GitHub would reject', () => {
    const huge = 'x'.repeat(300)
    const many = Array.from({ length: 400 }, (_, i) =>
      ticket({ number: 100 + i, title: huge, pulls: [{ number: 1000 + i, url: 'u', body: `## Summary\n${huge}\n${block([huge, huge])}`, runs: [] }] }),
    )
    expect(() => epicRollup(input({ tickets: many }))).toThrow(`over ${BODY_LIMIT}`)
  })
})
