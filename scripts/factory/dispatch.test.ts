import { describe, expect, it, vi } from 'vitest'
import {
  check, contextCheck, refreshRollup, isSyncTicket, syncCheck, syncTitle, contextComment, followup, followupId, ticketId, resume, resumeSkipReason, epicReady, epicReadyMessage, landed, notify, readiness, restGitHub, slackMessage, slackText, ticketNumber, trimmed, unblock, webhookUrl, refreshContext, refreshTargets,
  type Actor, type Blocker, type EpicPull, type GitHub, type Issue, type IssueRef, type LabelNotice, type Pull,
} from './dispatch.ts'
import type { RollupPull } from './rollup.ts'

const ref = (number: number, title: string, state: IssueRef['state'] = 'OPEN', labels: string[] = []): IssueRef => ({ number, title, state, labels })
const epic = { ...ref(2, 'E1 Foundation', 'OPEN', ['epic']), subIssues: [ref(11, 'T-02 Domain'), ref(12, 'T-04 Schema'), ref(13, 'T-20 Auth')] }
// A blocker in E1 (same epic as the default ticket) unless given another parent.
const blocker = (number: number, title: string, state: IssueRef['state'] = 'OPEN', parent: IssueRef | null = ref(2, 'E1 Foundation', 'OPEN', ['epic'])): Blocker => ({
  ...ref(number, title, state),
  parent,
})
const ticket = (overrides: Partial<Issue> = {}): Issue => ({
  ...ref(12, 'T-04 Schema', 'OPEN', ['queued']),
  parent: epic,
  subIssues: [],
  blockedBy: [],
  blocking: [],
  ...overrides,
})

// A fake GitHub that records every write in order, so tests can assert on sequencing.
function fakeGitHub(
  issues: Issue[],
  pull?: Pull,
  notice?: LabelNotice,
  epicPull: EpicPull | null = null,
  unlabeler: Actor | null = null,
): GitHub & {
  calls: string[]
  mergeableState: boolean | null
  issueBodies: Record<number, string>
  merged: Omit<RollupPull, 'runs'>[]
  detail: { body: string; headSha: string; comments: { author: string | null; body: string }[] }
} {
  const calls: string[] = []
  const byNumber = new Map(issues.map((i) => [i.number, i]))
  return {
    calls,
    mergeableState: true,
    issueBodies: {},
    merged: [],
    detail: { body: '', headSha: 'b'.repeat(40), comments: [] },
    async issueBody(n) {
      return this.issueBodies[n] ?? ''
    },
    async mergedPulls() {
      return this.merged
    },
    async pullDetail() {
      return this.detail
    },
    async editPullBody(n, body) {
      calls.push(`edit body #${n}: ${body.split('\n')[0]}`)
    },
    async issue(n) {
      const found = byNumber.get(n)
      if (!found) throw new Error(`no issue ${n}`)
      return found
    },
    async pull() {
      if (!pull) throw new Error('no pull')
      return pull
    },
    async comment(n, body) {
      calls.push(`comment #${n} ${body.split('\n')[0]}`)
    },
    async postContext(n, body) {
      calls.push(`context #${n} ${body.split('\n')[0]}`)
    },
    async addLabels(n, labels) {
      calls.push(`label #${n} +${labels.join(',')}`)
    },
    async removeLabel(n, label) {
      calls.push(`label #${n} -${label}`)
    },
    async close(n) {
      calls.push(`close #${n}`)
      const found = byNumber.get(n)
      if (found) found.state = 'CLOSED'
      for (const i of byNumber.values()) for (const r of [...i.blockedBy, ...i.subIssues]) if (r.number === n) r.state = 'CLOSED'
    },
    async labelNotice(n, label) {
      calls.push(`read notice #${n} ${label}`)
      if (!notice) throw new Error('no notice')
      return notice
    },
    async unlabeledBy(n, label) {
      calls.push(`read unlabel #${n} ${label}`)
      return unlabeler
    },
    async epicPull(n) {
      calls.push(`find epic pull for #${n}`)
      return epicPull
    },
    async openEpicPulls() {
      calls.push('list epic pulls')
      return epicPull ? [{ ...epicPull, epic: Number(epicPull.head.replace('epic/', '')) }] : []
    },
    async mergeable() {
      return this.mergeableState
    },
    async markReady(p) {
      calls.push(`ready #${p.number}`)
      if (epicPull) epicPull.draft = false
    },
    async dispatchWorkflow(file, ref, inputs) {
      calls.push(`dispatch ${file} on ${ref}${inputs ? ` ${JSON.stringify(inputs)}` : ''}`)
    },
    async createSubIssue({ title, body, epic, blockedBy }) {
      calls.push(`create "${title}" in #${epic}${blockedBy ? ` blocked by #${blockedBy}` : ''}: ${body.split('\n')[0]}`)
      // Registered so a later `check` on it can read it, as GitHub would serve it.
      const parent = byNumber.get(epic)
      const created: Issue = {
        ...ref(50, title),
        parent: parent ? { ...ref(parent.number, parent.title, parent.state, parent.labels), subIssues: parent.subIssues } : null,
        subIssues: [],
        blockedBy: [],
        blocking: [],
      }
      byNumber.set(50, created)
      parent?.subIssues.push(ref(50, title))
      return 50
    },
  }
}

const silent = (): void => {}

describe('readiness', () => {
  it('is ready with an epic parent and no blockers', () => {
    expect(readiness(ticket())).toEqual({ ready: true })
  })
  it('is ready when a closed blocker is in the same epic, even though the epic is open', () => {
    expect(readiness(ticket({ blockedBy: [blocker(11, 'T-02', 'CLOSED')] }))).toEqual({ ready: true })
  })
  it('waits on a closed blocker in another epic that is still open', () => {
    const e3Ticket = ticket({ parent: { ...ref(4, 'E3 App', 'OPEN', ['epic']), subIssues: [] }, blockedBy: [blocker(12, 'T-04', 'CLOSED')] })
    expect(readiness(e3Ticket)).toEqual({ ready: false, reason: 'blocked by #12 (its epic #2 has not merged into main)' })
  })
  it('is ready when a closed blocker is in another epic that is closed', () => {
    const e3Ticket = ticket({
      parent: { ...ref(4, 'E3 App', 'OPEN', ['epic']), subIssues: [] },
      blockedBy: [blocker(12, 'T-04', 'CLOSED', ref(2, 'E1 Foundation', 'CLOSED', ['epic']))],
    })
    expect(readiness(e3Ticket)).toEqual({ ready: true })
  })
  it('is ready when a closed blocker has no epic parent', () => {
    expect(readiness(ticket({ blockedBy: [blocker(9, 'D-01 Decision', 'CLOSED', null)] }))).toEqual({ ready: true })
  })
  it('treats a closed blocker whose parent is not an epic as having no epic parent', () => {
    expect(readiness(ticket({ blockedBy: [blocker(9, 'D-01 Decision', 'CLOSED', ref(8, 'Tracking', 'OPEN'))] }))).toEqual({ ready: true })
  })
  it('is not ready while any blocker is open, whatever its epic', () => {
    expect(readiness(ticket({ blockedBy: [blocker(11, 'T-02', 'CLOSED'), blocker(10, 'T-01', 'OPEN', null)] }))).toEqual({ ready: false, reason: 'blocked by #10' })
  })
  it('is not ready without a parent', () => {
    expect(readiness(ticket({ parent: null })).ready).toBe(false)
  })
  it('is not ready when the parent is not an epic', () => {
    expect(readiness(ticket({ parent: { ...epic, labels: [] } })).ready).toBe(false)
  })
})

describe('ticketNumber', () => {
  it('reads the Ticket line', () => {
    expect(ticketNumber('Some summary\n\nTicket: #11\n\nmore')).toBe(11)
  })
  it('reads a Ticket line followed by more text on the same line', () => {
    expect(ticketNumber('Ticket: #12 adds the schema')).toBe(12)
  })
  it('accepts the same number repeated', () => {
    expect(ticketNumber('Ticket: #12\n...\nticket: #12')).toBe(12)
  })
  it('rejects a body without one', () => {
    expect(() => ticketNumber('Closes #12')).toThrow(/found 0/)
  })
  it('rejects a mention in the middle of a line', () => {
    expect(() => ticketNumber('see Ticket: #12')).toThrow(/found 0/)
  })
  it('rejects two different tickets', () => {
    expect(() => ticketNumber('Ticket: #12\nTicket: #13')).toThrow(/found 2/)
  })
})

describe('check', () => {
  it('posts the context comment before adding factory-ready, then removes blocked', async () => {
    const issue = ticket({ labels: ['queued', 'blocked'], blockedBy: [blocker(11, 'T-02 Domain', 'CLOSED')] })
    const github = fakeGitHub([issue])
    const searched: string[] = []
    const result = await check(12, {
      github,
      context: async (args) => {
        searched.push(args.join(' '))
        return 'no entries'
      },
      now: () => new Date('2026-11-07T12:00:00Z'),
      log: silent,
    })
    expect(result).toBe('ready')
    expect(github.calls).toEqual(['context #12 ## Context from earlier tickets', 'label #12 +factory-ready', 'label #12 -blocked'])
    // The blocker first, then the epic's other tickets, never the ticket itself.
    expect(searched).toEqual(['search --topic T-02 --limit 50', 'search --topic T-20 --limit 50'])
  })
  it('adds blocked and posts nothing while a blocker is open', async () => {
    const github = fakeGitHub([ticket({ blockedBy: [blocker(11, 'T-02 Domain')] })])
    const result = await check(12, { github, context: async () => 'unused', log: silent })
    expect(result).toBe('blocked')
    expect(github.calls).toEqual(['label #12 +blocked'])
  })
  it('skips epics and tickets already marked factory-ready', async () => {
    const github = fakeGitHub([{ ...ticket(), labels: ['epic', 'queued'] }, { ...ticket(), number: 13, labels: ['factory-ready'] }])
    expect(await check(12, { github, context: async () => '', log: silent })).toBe('skipped')
    expect(await check(13, { github, context: async () => '', log: silent })).toBe('skipped')
    expect(github.calls).toEqual([])
  })
  it('does not add factory-ready when the context search fails', async () => {
    const github = fakeGitHub([ticket()])
    const context = async (): Promise<string> => {
      throw new Error('sign-in failed')
    }
    await expect(check(12, { github, context, log: silent })).rejects.toThrow('sign-in failed')
    expect(github.calls).toEqual([])
  })
})

describe('resume', () => {
  const person: Actor = { login: 'austin', type: 'User' }
  const deps = (github: GitHub) => ({ github, context: async () => 'no entries', now: () => new Date('2026-11-07T12:00:00Z'), log: silent })

  it('re-queues a ticket when a person removes needs-human: comments, then runs check', async () => {
    const github = fakeGitHub([ticket()], undefined, undefined, null, person)
    expect(await resume(12, deps(github))).toBe('ready')
    expect(github.calls).toEqual([
      'read unlabel #12 needs-human',
      'comment #12 Resuming: a person answered and removed needs-human.',
      'context #12 ## Context from earlier tickets',
      'label #12 +factory-ready',
    ])
  })
  it('removes factory-ready before check runs, so check does not skip it', async () => {
    const github = fakeGitHub([ticket({ labels: ['queued', 'factory-ready'] })], undefined, undefined, null, person)
    // The fake keeps returning the issue as fetched, so mirror the removal the way GitHub would.
    const removeLabel = github.removeLabel.bind(github)
    github.removeLabel = async (n, label) => {
      await removeLabel(n, label)
      const issue = await github.issue(n)
      issue.labels = issue.labels.filter((l) => l !== label)
    }
    expect(await resume(12, deps(github))).toBe('ready')
    expect(github.calls).toEqual([
      'read unlabel #12 needs-human',
      'comment #12 Resuming: a person answered and removed needs-human.',
      'label #12 -factory-ready',
      'context #12 ## Context from earlier tickets',
      'label #12 +factory-ready',
    ])
  })
  it('skips when a bot removed the label, since the factory removes it after successful reviews', async () => {
    const github = fakeGitHub([ticket()], undefined, undefined, null, { login: 'warp-agent', type: 'Bot' })
    const lines: string[] = []
    expect(await resume(12, { ...deps(github), log: (l: string) => lines.push(l) })).toBe('skipped')
    expect(github.calls).toEqual(['read unlabel #12 needs-human'])
    expect(lines).toEqual(['#12: skipped resume, needs-human was removed by Bot warp-agent, not a person'])
  })
  it('skips epics and closed issues', async () => {
    const github = fakeGitHub([ticket({ labels: ['epic'] }), ticket({ number: 13, state: 'CLOSED' })], undefined, undefined, null, person)
    expect(await resume(12, deps(github))).toBe('skipped')
    expect(await resume(13, deps(github))).toBe('skipped')
    expect(github.calls.filter((c) => !c.startsWith('read'))).toEqual([])
  })
  it('skips an unknown actor and a label that was added back', () => {
    expect(resumeSkipReason(ticket(), null)).toBe('needs-human was removed by an unknown actor, not a person')
    expect(resumeSkipReason(ticket({ labels: ['queued', 'needs-human'] }), person)).toBe('it has needs-human again')
    expect(resumeSkipReason(ticket(), person)).toBeNull()
  })
})

describe('landed', () => {
  const pull: Pull = {
    number: 40,
    url: 'https://github.com/vibing-out/vbt/pull/40',
    author: 'someone',
    merged: true,
    base: 'epic/2',
    body: 'Ticket: #11\n\n```context-log\n{"version":1,"decisions":[],"corrections":[]}\n```',
    mergeCommit: 'a'.repeat(40),
  }
  const setup = (): { github: ReturnType<typeof fakeGitHub> } => {
    const t02 = { ...ref(11, 'T-02 Domain', 'OPEN', ['factory-ready']), parent: epic, subIssues: [], blockedBy: [], blocking: [ref(12, 'T-04 Schema', 'OPEN', ['queued', 'blocked'])] }
    const t04 = ticket({ labels: ['queued', 'blocked'], blockedBy: [blocker(11, 'T-02 Domain')] })
    return { github: fakeGitHub([t02, t04], pull) }
  }

  it('skips ingestion for a merged Dependabot pull request into main with no block', async () => {
    const dependabot: Pull = { ...pull, author: 'dependabot[bot]', base: 'main', body: 'Bumps foo from 1 to 2.' }
    const runs: string[] = []
    await landed(40, { github: fakeGitHub([], dependabot), context: async (args) => (runs.push(args[0] ?? ''), 'ok'), log: silent })
    expect(runs).toEqual([])
  })
  it('ingests, closes the ticket and re-checks what it was blocking', async () => {
    const { github } = setup()
    const runs: string[] = []
    await landed(40, { github, context: async (args) => (runs.push(args[0] ?? ''), 'ok'), log: silent })
    expect(runs[0]).toBe('ingest')
    expect(github.calls).toEqual(['close #11', 'context #12 ## Context from earlier tickets', 'label #12 +factory-ready', 'label #12 -blocked', 'find epic pull for #2'])
  })
  it('passes the pull request URL, merge commit and ticket id to ingest, with the body on stdin', async () => {
    const { github } = setup()
    let seen: { args: string[]; input?: string } | undefined
    await landed(40, {
      github,
      context: async (args, input) => {
        if (args[0] === 'ingest') seen = { args, input }
        return 'ok'
      },
      log: silent,
    })
    expect(seen?.args).toEqual(['ingest', '--source', pull.url, '--commit', pull.mergeCommit, '--topic', 'T-02'])
    expect(seen?.input).toBe(pull.body)
  })
  it('labels needs-human and stops when ingestion fails', async () => {
    const { github } = setup()
    const context = async (): Promise<string> => {
      throw new Error('context-log block is not valid JSON')
    }
    await expect(landed(40, { github, context, log: silent })).rejects.toThrow(/ingestion failed/)
    expect(github.calls).toEqual(['label #11 +needs-human', 'comment #11 Context ingestion failed for pull request #40, so dependent tickets were not dispatched.'])
  })
  it('ignores pull requests that merged into neither an epic branch nor main', async () => {
    const github = fakeGitHub([], { ...pull, base: 'feature/x' })
    await landed(40, { github, context: async () => 'unused', log: silent })
    expect(github.calls).toEqual([])
  })

  const ingestArgs = async (body: string, issues: Issue[] = []): Promise<{ args?: string[]; calls: string[] }> => {
    const github = fakeGitHub(issues, { ...pull, base: 'main', body })
    let args: string[] | undefined
    await landed(40, { github, context: async (a) => ((args = a), 'ok'), log: silent })
    return { args, calls: github.calls }
  }
  it('logs a setup pull request merged into main under topic setup, closing nothing', async () => {
    const { args, calls } = await ingestArgs('```context-log\n{"version":1,"decisions":[],"corrections":[]}\n```')
    expect(args).toEqual(['ingest', '--source', pull.url, '--commit', pull.mergeCommit, '--topic', 'setup'])
    expect(calls).toEqual([])
  })
  it('logs a pull request into main under its ticket id when the body names one ticket', async () => {
    const { args } = await ingestArgs(pull.body, [ticket({ number: 11, title: 'T-02 Domain' })])
    expect(args?.at(-1)).toBe('T-02')
  })
  it('comments on the pull request when ingestion into main fails', async () => {
    const github = fakeGitHub([], { ...pull, base: 'main', body: 'no block' })
    const context = async (): Promise<string> => {
      throw new Error('no context-log block')
    }
    await expect(landed(40, { github, context, log: silent })).rejects.toThrow(/ingestion failed for pull request #40/)
    expect(github.calls).toEqual(['comment #40 Context ingestion failed for this pull request; log it by hand.'])
  })
})

describe('follow-up tickets', () => {
  it('reads a follow-up id from a title', () => {
    expect(ticketId('T-04a Judgment fixes')).toBe('T-04a')
    expect(ticketId('T-04 Schema')).toBe('T-04')
  })
  it('takes the first free letter, and continues the series from a follow-up', () => {
    expect(followupId('T-04 Schema', ['T-02 Domain', 'T-04 Schema'])).toBe('T-04a')
    expect(followupId('T-04 Schema', ['T-04 Schema', 'T-04a Fixes'])).toBe('T-04b')
    expect(followupId('T-04a Fixes', ['T-04 Schema', 'T-04a Fixes'])).toBe('T-04b')
  })
  it('opens a sub-issue of the same epic, blocked by the original, then queues it', async () => {
    const github = fakeGitHub([ticket({ state: 'CLOSED' })])
    const created = await followup(12, ' Judgment fixes ', 'Fix the public views.', { github, context: async () => '', log: silent })
    expect(created).toBe(50)
    expect(github.calls).toEqual(['create "T-04a Judgment fixes" in #2 blocked by #12: Follow-up to #12 (T-04 Schema).', 'label #50 +queued'])
  })
  it('refuses a ticket with no parent epic', async () => {
    const github = fakeGitHub([ticket({ parent: null })])
    await expect(followup(12, 'Fixes', '', { github, context: async () => '', log: silent })).rejects.toThrow(/no parent epic/)
    expect(github.calls).toEqual([])
  })
})

describe('context refresh', () => {
  // T-02 (#11) lands. T-04 (#12) is blocked by it and already with the factory; T-20 (#13) is in the
  // same epic and with the factory; T-01 (#10) is in the epic but still queued.
  const setup = () => {
    const e1 = { ...ref(2, 'E1 Foundation', 'OPEN', ['epic']), subIssues: [ref(10, 'T-01 Scaffold', 'OPEN', ['queued']), ref(11, 'T-02 Domain', 'OPEN', ['factory-ready']), ref(12, 'T-04 Schema', 'OPEN', ['factory-ready']), ref(13, 'T-20 Auth', 'OPEN', ['factory-ready'])] }
    const t02: Issue = { ...ref(11, 'T-02 Domain', 'OPEN', ['factory-ready']), parent: e1, subIssues: [], blockedBy: [], blocking: [ref(12, 'T-04 Schema', 'OPEN', ['factory-ready'])] }
    const t04 = ticket({ labels: ['factory-ready'], parent: e1, blockedBy: [blocker(11, 'T-02 Domain')] })
    const t20 = ticket({ ...ref(13, 'T-20 Auth', 'OPEN', ['factory-ready']), parent: e1 })
    return { t02, github: fakeGitHub([t02, t04, t20]) }
  }
  it('targets open factory-ready tickets the landed one blocks or shares an epic with, once each and never itself', () => {
    expect(refreshTargets(setup().t02).map((r) => r.number)).toEqual([12, 13])
  })
  it('skips closed tickets', () => {
    const { t02 } = setup()
    t02.blocking = [ref(12, 'T-04 Schema', 'CLOSED', ['factory-ready'])]
    t02.parent = t02.parent && { ...t02.parent, subIssues: [] }
    expect(refreshTargets(t02)).toEqual([])
  })
  it('rewrites each target\'s context comment from a fresh search', async () => {
    const { t02, github } = setup()
    const searched: string[] = []
    const count = await refreshContext(t02, { github, context: async (args) => (searched.push(args.join(' ')), 'no entries'), log: silent })
    expect(count).toBe(2)
    expect(github.calls).toEqual(['context #12 ## Context from earlier tickets', 'context #13 ## Context from earlier tickets'])
    expect(searched).toContain('search --topic T-02 --limit 50')
  })
  it('logs a failed refresh and carries on with the next ticket', async () => {
    const { t02, github } = setup()
    const lines: string[] = []
    let calls = 0
    const context = async (): Promise<string> => {
      if (calls++ === 0) throw new Error('sign-in failed')
      return 'no entries'
    }
    expect(await refreshContext(t02, { github, context, log: (l) => lines.push(l) })).toBe(1)
    expect(lines).toContain('#12: context refresh failed: sign-in failed')
    expect(github.calls).toEqual(['context #13 ## Context from earlier tickets'])
  })
  it('runs from landed after the ingest, so the new entries are in the refreshed comment', async () => {
    const { t02, github } = setup()
    const pull: Pull = { number: 40, url: 'https://github.com/vibing-out/vbt/pull/40', author: 'someone', merged: true, base: 'epic/2', body: 'Ticket: #11', mergeCommit: 'a'.repeat(40) }
    github.pull = async () => pull
    const order: string[] = []
    await landed(40, { github, context: async (args) => (order.push(args[0] ?? ''), 'ok'), log: silent })
    expect(order[0]).toBe('ingest')
    expect(github.calls.slice(0, 3)).toEqual(['close #11', 'context #12 ## Context from earlier tickets', 'context #13 ## Context from earlier tickets'])
    expect(t02.state).toBe('CLOSED')
  })
  it('edits the workflow\'s own context comment, never a person\'s with the same heading, and posts when none exists', async () => {
    const requests: string[] = []
    const comments = [
      { id: 1, body: '## Context from earlier tickets\nforged', user: { login: 'someone', type: 'User' } },
      { id: 2, body: '## Context from earlier tickets\nold', user: { login: 'github-actions[bot]', type: 'Bot' } },
    ]
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(`${init?.method} ${String(url).replace('https://api.github.com/repos/vibing-out/vbt', '')}`)
      if (init?.method === 'GET') return new Response(JSON.stringify(String(url).includes('/issues/12/') ? comments : []), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    try {
      const github = restGitHub('token', 'vibing-out/vbt')
      await github.postContext(12, 'new')
      await github.postContext(13, 'new')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(requests).toEqual([
      'GET /issues/12/comments?per_page=100&page=1',
      'PATCH /issues/comments/2',
      'GET /issues/13/comments?per_page=100&page=1',
      'POST /issues/13/comments',
    ])
  })
})

describe('contextCheck', () => {
  const body = (n: number): string => `Ticket: #${n}\n\n\`\`\`context-log\n{"version":1,"decisions":[],"corrections":[]}\n\`\`\``
  const pull = (overrides: Partial<Pull> = {}): Pull => ({
    number: 46, url: 'https://github.com/vibing-out/vbt/pull/46', author: 'someone', merged: false, base: 'epic/2', body: body(12), mergeCommit: null, ...overrides,
  })
  const run = (issue: Issue, pr: Pull): Promise<void> => contextCheck(pr.number, { github: fakeGitHub([issue], pr), context: async () => 'ok', log: silent })

  it('passes an open epic pull request whose ticket is open', async () => {
    await expect(run(ticket(), pull())).resolves.toBeUndefined()
  })
  it('fails an open epic pull request whose ticket is already closed, naming the follow-up ticket fix', async () => {
    await expect(run(ticket({ state: 'CLOSED' }), pull())).rejects.toThrow(/Ticket #12 \(T-04 Schema\) is already closed.*follow-up ticket.*blocked by #12/)
  })
  it('fails an open epic pull request whose ticket is the epic itself, naming the sync ticket fix', async () => {
    await expect(run(ticket({ labels: ['epic'] }), pull())).rejects.toThrow(
      "Ticket #12 is an epic. Open a sync ticket (for example 'T-00<letter> Sync epic/<k> with main', a sub-issue of the epic) and name that instead.",
    )
  })
  it('passes an open epic pull request whose ticket has other labels', async () => {
    await expect(run(ticket({ labels: ['factory-ready', 'local'] }), pull())).resolves.toBeUndefined()
  })
  it('passes a merged pull request, whose ticket `landed` closed', async () => {
    await expect(run(ticket({ state: 'CLOSED' }), pull({ merged: true }))).resolves.toBeUndefined()
  })
  it('does not look up a ticket for a pull request into main', async () => {
    await expect(run(ticket({ state: 'CLOSED' }), pull({ base: 'main', body: body(99) }))).resolves.toBeUndefined()
  })
  describe('Dependabot', () => {
    const dependabot = { author: 'dependabot[bot]', base: 'main' }
    const checked: string[][] = []
    const runChecked = (pr: Pull): Promise<void> =>
      contextCheck(pr.number, { github: fakeGitHub([ticket()], pr), context: async (args) => { checked.push(args); return 'ok' }, log: silent })
    it('passes without running the check when the body has no context-log block', async () => {
      checked.length = 0
      await runChecked(pull({ ...dependabot, body: 'Bumps foo from 1 to 2.' }))
      expect(checked).toEqual([])
    })
    it('still validates a block that is present', async () => {
      checked.length = 0
      await runChecked(pull({ ...dependabot, body: body(1) }))
      expect(checked).toEqual([['check']])
    })
    it('does not exempt other authors', async () => {
      checked.length = 0
      await runChecked(pull({ base: 'main', body: 'no block' }))
      expect(checked).toEqual([['check']])
    })
  })
})

describe('unblock', () => {
  // E1 (#2) holds T-02 (#11) and T-04 (#12). T-30 (#30) is in E3 and blocked by T-04; T-31 (#31) is in
  // E3 and blocked by T-02 but not queued yet; T-05 (#14) is in E1 and blocked by T-04.
  const e3 = { ...ref(4, 'E3 App', 'OPEN', ['epic']), subIssues: [ref(30, 'T-30 Screen'), ref(31, 'T-31 Menu')] }
  const setup = (epicState: IssueRef['state']): ReturnType<typeof fakeGitHub> => {
    const e1Ref = ref(2, 'E1 Foundation', epicState, ['epic'])
    const e1: Issue = { ...e1Ref, parent: null, subIssues: [ref(11, 'T-02 Domain', 'CLOSED'), ref(12, 'T-04 Schema', 'CLOSED')], blockedBy: [], blocking: [] }
    const t02: Issue = { ...ref(11, 'T-02 Domain', 'CLOSED'), parent: { ...e1Ref, subIssues: [] }, subIssues: [], blockedBy: [], blocking: [ref(31, 'T-31 Menu', 'OPEN', [])] }
    const t04: Issue = {
      ...ref(12, 'T-04 Schema', 'CLOSED'),
      parent: { ...e1Ref, subIssues: [] },
      subIssues: [],
      blockedBy: [],
      blocking: [ref(30, 'T-30 Screen', 'OPEN', ['queued', 'blocked']), ref(14, 'T-05 Seed', 'OPEN', ['queued', 'blocked'])],
    }
    const t30: Issue = { ...ref(30, 'T-30 Screen', 'OPEN', ['queued', 'blocked']), parent: e3, subIssues: [], blockedBy: [blocker(12, 'T-04 Schema', 'CLOSED', e1Ref)], blocking: [] }
    const t05: Issue = { ...ref(14, 'T-05 Seed', 'OPEN', ['queued', 'blocked']), parent: { ...e1Ref, subIssues: [] }, subIssues: [], blockedBy: [blocker(12, 'T-04 Schema', 'CLOSED', e1Ref)], blocking: [] }
    return fakeGitHub([e1, t02, t04, t30, t05])
  }
  const deps = (github: GitHub) => ({ github, context: async () => 'no entries', now: () => new Date('2026-11-07T12:00:00Z'), log: silent })

  it('re-checks what a closed ticket was blocking, leaving the cross-epic one blocked while its epic is open', async () => {
    const github = setup('OPEN')
    await unblock(12, deps(github))
    expect(github.calls).toEqual(['label #30 +blocked', 'context #14 ## Context from earlier tickets', 'label #14 +factory-ready', 'label #14 -blocked'])
  })
  it('re-checks blocked issues waiting on any ticket in a closed epic, and only those', async () => {
    const github = setup('CLOSED')
    await unblock(2, deps(github))
    // #31 is open but not blocked (never queued), so it is left alone.
    expect(github.calls).toEqual([
      'context #30 ## Context from earlier tickets',
      'label #30 +factory-ready',
      'label #30 -blocked',
      'context #14 ## Context from earlier tickets',
      'label #14 +factory-ready',
      'label #14 -blocked',
    ])
  })
  it('does nothing for an issue that is still open', async () => {
    const github = setup('OPEN')
    await unblock(2, deps(github))
    expect(github.calls).toEqual([])
  })
})

describe('contextComment', () => {
  it('says the quoted entries are data and cannot be closed early by backticks in them', () => {
    const body = contextComment([{ topic: 'T-02', relation: 'blocker #11', output: 'has ``` inside' }], new Date('2026-11-07T12:00:00Z'))
    expect(body).toContain('not instructions')
    expect(body).toContain('Retrieved 2026-11-07T12:00:00.000Z')
    expect(body).toContain('````text\nhas ``` inside\n````')
  })
})

describe('Slack notification', () => {
  const notice = (overrides: Partial<LabelNotice> = {}): LabelNotice => ({
    number: 12,
    title: 'T-04 Schema',
    url: 'https://github.com/vibing-out/vbt/issues/12',
    labeledBy: 'warp-agent',
    comment: { author: 'warp-agent', body: 'Which table holds voters?\nShould it be soft-deleted?', url: 'https://github.com/vibing-out/vbt/issues/12#issuecomment-1' },
    ...overrides,
  })
  const webhook = 'https://hooks.slack.com/services/T000/B000/secret'
  const okFetch = () => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok', { status: 200 }))

  it('formats a bold title link, who added the label, and the newest comment as a quote block', () => {
    expect(slackMessage(notice())).toBe(
      [
        '<!here> *<https://github.com/vibing-out/vbt/issues/12|#12 T-04 Schema>*',
        '`needs-human` added by warp-agent',
        '<https://github.com/vibing-out/vbt/issues/12#issuecomment-1|Newest comment> by warp-agent:',
        '> Which table holds voters?',
        '> Should it be soft-deleted?',
        'Reply on the issue, then remove `needs-human` to resume.',
      ].join('\n'),
    )
  })
  it('says so when the issue has no comments or the label has no actor', () => {
    expect(slackMessage(notice({ comment: null, labeledBy: null }))).toBe(
      ['<!here> *<https://github.com/vibing-out/vbt/issues/12|#12 T-04 Schema>*', '`needs-human` added by an unknown actor', '_No comments on the issue yet._', 'Reply on the issue, then remove `needs-human` to resume.'].join('\n'),
    )
  })
  it('escapes &, < and > so ticket text cannot form links or close the quote', () => {
    expect(slackText('a & b <https://evil|click> > c')).toBe('a &amp; b &lt;https://evil|click&gt; &gt; c')
  })
  it('strips @channel, @here, @everyone and <!...> commands, including pieces that rejoin', () => {
    expect(slackText('hey @channel and @HERE and @everyone')).toBe('hey  and  and ')
    expect(slackText('ping <!channel> <!subteam^S123|devs> <!date^1|x>')).toBe('ping   ')
    expect(slackText('<<!here>!here>')).toBe('')
    expect(slackText('@@here! @hereford')).toBe('@! @hereford')
  })
  it('escapes and strips the title and the comment in the full message', () => {
    const text = slackMessage(notice({ title: 'Fix <a> & @here', comment: { author: 'x', body: '<!channel> 1 > 0', url: 'u' } }))
    expect(text).toContain('|#12 Fix &lt;a&gt; &amp; >*')
    expect(text).toContain('\n>  1 &gt; 0')
    // Only our own leading @here survives; nothing from the ticket text can mention anyone.
    expect(text.startsWith('<!here> ')).toBe(true)
    expect(text.slice('<!here> '.length)).not.toMatch(/<!|@here|@channel/)
  })
  it('trims the comment to 1,500 characters without splitting an emoji', () => {
    expect(trimmed('short')).toBe('short')
    const long = trimmed('x'.repeat(2_000))
    expect(long).toBe(`${'x'.repeat(1_500)}…`)
    expect(trimmed(`${'x'.repeat(1_499)}😀😀`)).toBe(`${'x'.repeat(1_499)}😀…`)
    const quoted = slackMessage(notice({ comment: { author: 'a', body: 'y'.repeat(5_000), url: 'u' } })).split('\n').at(-2)
    expect(quoted).toBe(`> ${'y'.repeat(1_500)}…`)
  })
  it('skips without reading GitHub or posting when the webhook is unset or empty', async () => {
    for (const slackWebhook of [undefined, '']) {
      const github = fakeGitHub([], undefined, notice())
      const post = okFetch()
      const lines: string[] = []
      expect(await notify(12, { github, context: async () => '', slackWebhook, fetch: post, log: (l) => lines.push(l) })).toBe('skipped')
      expect(lines).toEqual(['Slack webhook not configured; skipping'])
      expect(post).not.toHaveBeenCalled()
      expect(github.calls).toEqual([])
    }
  })
  it('posts the message as JSON to the webhook', async () => {
    const github = fakeGitHub([], undefined, notice())
    const post = okFetch()
    expect(await notify(12, { github, context: async () => '', slackWebhook: webhook, fetch: post, log: silent })).toBe('posted')
    expect(github.calls).toEqual(['read notice #12 needs-human'])
    const [url, init] = post.mock.calls[0] ?? []
    expect(url).toBe(webhook)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ text: slackMessage(notice()), unfurl_links: false, unfurl_media: false })
  })
  it('fails on a rejected post without putting the webhook URL in the error', async () => {
    const github = fakeGitHub([], undefined, notice())
    const post = vi.fn(async () => new Response('invalid_payload', { status: 400 }))
    const err = await notify(12, { github, context: async () => '', slackWebhook: webhook, fetch: post, log: silent }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Slack webhook returned 400: invalid_payload')
  })
  describe('from landed, since a label added with GITHUB_TOKEN starts no workflow', () => {
    const pull: Pull = { number: 40, url: 'https://github.com/vibing-out/vbt/pull/40', author: 'someone', merged: true, base: 'epic/2', body: 'Ticket: #12', mergeCommit: 'a'.repeat(40) }
    const failing = async (): Promise<string> => {
      throw new Error('context-log block missing')
    }
    it('posts after labeling and commenting when ingestion fails', async () => {
      const github = fakeGitHub([ticket()], pull, notice())
      const post = okFetch()
      await expect(landed(40, { github, context: failing, slackWebhook: webhook, fetch: post, log: silent })).rejects.toThrow(/ingestion failed for #12/)
      expect(github.calls).toEqual(['label #12 +needs-human', 'comment #12 Context ingestion failed for pull request #40, so dependent tickets were not dispatched.', 'read notice #12 needs-human'])
      expect(post).toHaveBeenCalledOnce()
    })
    it('still reports the ingestion error when the Slack post fails', async () => {
      const github = fakeGitHub([ticket()], pull, notice())
      const lines: string[] = []
      const post = vi.fn(async () => new Response('no_service', { status: 404 }))
      await expect(landed(40, { github, context: failing, slackWebhook: webhook, fetch: post, log: (l) => lines.push(l) })).rejects.toThrow(/ingestion failed for #12: context-log block missing/)
      expect(lines).toEqual(['#12: Slack notification failed: Slack webhook returned 404: no_service'])
    })
  })
})

describe('webhookUrl', () => {
  const url = 'https://hooks.slack.com/services/T000/B000/abcDEF123'
  it.each([
    ['a bare URL', url],
    ['surrounding whitespace and quotes', `  "${url}"\n`],
    ['the whole curl example Slack shows', `curl -X POST -H 'Content-type: application/json' --data '{"text":"Hello"}' ${url}`],
  ])('extracts the URL from %s', (_label, secret) => {
    expect(webhookUrl(secret)).toBe(url)
  })
  it('returns null when no Slack webhook URL is present', () => {
    expect(webhookUrl('not a url')).toBeNull()
    expect(webhookUrl(undefined)).toBeNull()
  })
})

describe('epicReady from landed', () => {
  // E1 (#2) holds T-02 (#11) and T-04 (#12); pull request #40 merges T-02 into epic/2. Built fresh per
  // test, since the fake's close mutates the sub-issue states.
  const webhook = 'https://hooks.slack.com/services/T000/B000/secret'
  const pull: Pull = {
    number: 40,
    url: 'https://github.com/vibing-out/vbt/pull/40',
    author: 'someone',
    merged: true,
    base: 'epic/2',
    body: 'Ticket: #11',
    mergeCommit: 'a'.repeat(40),
  }
  const epicPull = (draft = true): EpicPull => ({ number: 39, url: 'https://github.com/vibing-out/vbt/pull/39', draft, nodeId: 'PR_39', head: 'epic/2' })
  // `landedState` is T-02's state as the epic reports it: open when `landed` will close it, closed when
  // a test calls epicReady directly.
  const setup = (siblingState: IssueRef['state'], epicPr: EpicPull | null, landedState: IssueRef['state'] = 'OPEN') => {
    const e1Ref = ref(2, 'E1 Foundation', 'OPEN', ['epic'])
    const e1: Issue = { ...e1Ref, parent: null, subIssues: [ref(11, 'T-02 Domain', landedState), ref(12, 'T-04 Schema', siblingState)], blockedBy: [], blocking: [] }
    const t02: Issue = { ...ref(11, 'T-02 Domain', 'OPEN', ['factory-ready']), parent: { ...e1Ref, subIssues: [] }, subIssues: [], blockedBy: [], blocking: [] }
    const github = fakeGitHub([e1, t02], pull, undefined, epicPr)
    const post = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok', { status: 200 }))
    const lines: string[] = []
    const deps = { github, context: async () => 'ok', fetch: post, log: (l: string) => lines.push(l) }
    return { github, post, lines, deps }
  }

  it('updates the branch, dispatches its checks, marks it ready, comments and posts to Slack once the last ticket closes', async () => {
    const { github, post, deps } = setup('CLOSED', epicPull())
    await landed(40, { ...deps, slackWebhook: webhook })
    expect(github.calls).toEqual([
      'close #11',
      'find epic pull for #2',
      'edit body #39: Closes #2',
      'find epic pull for #2',
      'dispatch ci.yml on epic/2',
      'dispatch factory.yml on epic/2 {"pr":"39"}',
      'ready #39',
      'comment #39 All tickets in E1 have merged. Ready for human approval into main.',
    ])
    expect(post).toHaveBeenCalledOnce()
    const [url, init] = post.mock.calls[0] ?? []
    expect(url).toBe(webhook)
    expect(JSON.parse(String(init?.body)).text).toBe('<!here> *<https://github.com/vibing-out/vbt/pull/39|E1 Foundation>* is ready for approval into main')
  })
  it('does nothing while a sibling ticket is still open', async () => {
    const { github, post, lines, deps } = setup('OPEN', epicPull())
    await landed(40, { ...deps, slackWebhook: webhook })
    // The epic pull request is still read, to catch a conflict with main early.
    expect(github.calls).toEqual(['close #11', 'find epic pull for #2', 'edit body #39: Closes #2', 'find epic pull for #2'])
    expect(post).not.toHaveBeenCalled()
    expect(lines).toContain('epic #2: waiting on #12')
  })
  it('does not comment or post again when the epic pull request is already ready', async () => {
    const { github, post, deps } = setup('CLOSED', epicPull(false), 'CLOSED')
    expect(await epicReady(2, { ...deps, slackWebhook: webhook })).toBe('already-ready')
    expect(github.calls).toEqual(['find epic pull for #2'])
    expect(post).not.toHaveBeenCalled()
  })
  it('a second run after a successful one repeats nothing', async () => {
    const { github, post, deps } = setup('CLOSED', epicPull(), 'CLOSED')
    expect(await epicReady(2, { ...deps, slackWebhook: webhook })).toBe('ready')
    expect(await epicReady(2, { ...deps, slackWebhook: webhook })).toBe('already-ready')
    expect(github.calls.filter((c) => c.startsWith('comment'))).toHaveLength(1)
    expect(post).toHaveBeenCalledOnce()
  })
  it('logs and returns when no epic pull request is open', async () => {
    const { github, lines, deps } = setup('CLOSED', null)
    await landed(40, deps)
    expect(github.calls).toEqual(['close #11', 'find epic pull for #2', 'find epic pull for #2'])
    expect(lines).toContain('epic #2: every ticket is closed, but no open pull request from epic/2 into main')
  })
  it('still marks it ready and comments, but posts nothing, without a webhook', async () => {
    for (const slackWebhook of [undefined, '']) {
      const { github, post, lines, deps } = setup('CLOSED', epicPull(), 'CLOSED')
      expect(await epicReady(2, { ...deps, slackWebhook })).toBe('ready')
      expect(github.calls).toContain('ready #39')
      expect(github.calls).toContain('comment #39 All tickets in E1 have merged. Ready for human approval into main.')
      expect(post).not.toHaveBeenCalled()
      expect(lines).toContain('Slack webhook not configured; skipping')
    }
  })
  it('logs a failure without failing landed, since the ticket has already merged', async () => {
    const { github, lines, deps } = setup('CLOSED', epicPull())
    github.dispatchWorkflow = async () => {
      throw new Error('502 from POST dispatches: bad gateway')
    }
    await expect(landed(40, deps)).resolves.toBeUndefined()
    // Not marked ready: its required checks never started. The roll-up was written before the readiness step.
    expect(github.calls).toEqual(['close #11', 'find epic pull for #2', 'edit body #39: Closes #2', 'find epic pull for #2'])
    expect(lines).toContain('epic #2: readiness step failed: 502 from POST dispatches: bad gateway')
  })
  it('dispatches the checks and marks ready without touching the epic branch, even when it is behind main', async () => {
    const { github, deps } = setup('CLOSED', epicPull(), 'CLOSED')
    expect(await epicReady(2, deps)).toBe('ready')
    expect(github.calls.filter((c) => c.startsWith('dispatch'))).toEqual(['dispatch ci.yml on epic/2', 'dispatch factory.yml on epic/2 {"pr":"39"}'])
  })
  it('sends the dispatch to the workflow dispatches endpoint with the branch and input', async () => {
    const requests: { method: string; url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ method: String(init?.method), url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: 204 })
    })
    try {
      const github = restGitHub('token', 'vibing-out/vbt')
      await github.dispatchWorkflow('ci.yml', 'epic/2')
      await github.dispatchWorkflow('factory.yml', 'epic/2', { pr: '39' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(requests).toEqual([
      { method: 'POST', url: 'https://api.github.com/repos/vibing-out/vbt/actions/workflows/ci.yml/dispatches', body: { ref: 'epic/2' } },
      { method: 'POST', url: 'https://api.github.com/repos/vibing-out/vbt/actions/workflows/factory.yml/dispatches', body: { ref: 'epic/2', inputs: { pr: '39' } } },
    ])
  })
  it('escapes the epic title in the Slack message', () => {
    expect(epicReadyMessage(epicPull(), 'E1 <@here> & co')).toBe('<!here> *<https://github.com/vibing-out/vbt/pull/39|E1 &lt;&gt; &amp; co>* is ready for approval into main')
  })
})

describe('sync tickets for an epic that conflicts with main', () => {
  // E1 (#2) holds T-02 (#11, just merged) and T-04 (#12, still open); epic pull request #39 is epic/2 into main.
  const epicPull = (): EpicPull => ({ number: 39, url: 'https://github.com/vibing-out/vbt/pull/39', draft: true, nodeId: 'PR_39', head: 'epic/2' })
  const setup = (siblings: IssueRef[] = [ref(12, 'T-04 Schema')], epicPr: EpicPull | null = epicPull()) => {
    const e1: Issue = { ...ref(2, 'E1 Foundation', 'OPEN', ['epic']), parent: null, subIssues: [ref(11, 'T-02 Domain', 'CLOSED'), ...siblings], blockedBy: [], blocking: [] }
    const github = fakeGitHub([e1], undefined, undefined, epicPr)
    github.mergeableState = false
    const lines: string[] = []
    const deps = { github, context: async () => 'ok', log: (l: string) => lines.push(l) }
    return { github, lines, deps }
  }
  const opened = [
    'find epic pull for #2',
    'create "T-00a Sync epic/2 with main" in #2: `main` and `epic/2` both changed the same lines, so epic pull request #39 conflicts and cannot merge.',
    'label #50 +queued',
    'context #50 ## Context from earlier tickets',
    'label #50 +factory-ready',
    'comment #39 This pull request conflicts with `main`. Opened #50 to merge `main` into `epic/2`.',
  ]

  it('recognizes only a T-00 sync title for the same epic', () => {
    expect(isSyncTicket(`T-00a ${syncTitle(2)}`, 2)).toBe(true)
    expect(isSyncTicket('T-00b Sync epic/2 with main', 2)).toBe(true)
    expect(isSyncTicket('T-00a Sync epic/4 with main', 2)).toBe(false)
    expect(isSyncTicket('T-04a Sync epic/2 with main', 2)).toBe(false)
  })
  it('opens, queues and dispatches a sync ticket at a landing, while other tickets are still open', async () => {
    const { github, deps } = setup()
    expect(await epicReady(2, deps)).toBe('conflict')
    expect(github.calls).toEqual(opened)
  })
  it('still dispatches the sync ticket when commenting on the epic pull request is refused (#78)', async () => {
    const { github, lines, deps } = setup()
    const comment = github.comment.bind(github)
    github.comment = async (n, body) => {
      if (n === 39) throw new Error('403 from POST /issues/39/comments: Resource not accessible by integration')
      return comment(n, body)
    }
    expect(await epicReady(2, deps)).toBe('conflict')
    expect(github.calls).toEqual(opened.slice(0, -1))
    expect(lines).toContain('epic #2: could not comment on #39: 403 from POST /issues/39/comments: Resource not accessible by integration')
  })
  it('opens no second sync ticket while one is open', async () => {
    const { github, lines, deps } = setup([ref(12, 'T-04 Schema'), ref(57, 'T-00a Sync epic/2 with main')])
    expect(await epicReady(2, deps)).toBe('conflict')
    expect(github.calls).toEqual(['find epic pull for #2'])
    expect(lines).toContain('epic #2: #39 conflicts with main; sync ticket #57 is already open')
  })
  it('takes the next letter after a closed sync ticket', async () => {
    const { github, deps } = setup([ref(57, 'T-00a Sync epic/2 with main', 'CLOSED')])
    expect(await epicReady(2, deps)).toBe('conflict')
    expect(github.calls).toContain('label #50 +queued')
    expect(github.calls.find((c) => c.startsWith('create'))).toMatch(/^create "T-00b Sync epic\/2 with main" in #2:/)
  })
  it('carries on without a ticket when GitHub has not computed mergeability yet', async () => {
    const { github, lines, deps } = setup()
    github.mergeableState = null
    expect(await epicReady(2, deps)).toBe('waiting')
    expect(github.calls).toEqual(['find epic pull for #2'])
    expect(lines).toContain('epic #2: GitHub has not computed whether #39 conflicts; the next landed or push to main re-checks')
  })
  it('on a push to main, opens a sync ticket for a conflicting epic pull request', async () => {
    const { github, lines, deps } = setup()
    await syncCheck(deps)
    expect(github.calls).toEqual(['list epic pulls', ...opened.slice(1)])
    expect(lines).toContain('checked 1 epic pull request(s) for conflicts with main')
  })
  it('on a push to main, does nothing for an epic pull request that merges cleanly', async () => {
    const { github, deps } = setup()
    github.mergeableState = true
    await syncCheck(deps)
    expect(github.calls).toEqual(['list epic pulls'])
  })
  it('on a push to main, reports an epic that could not be checked', async () => {
    const { github, deps } = setup()
    github.mergeable = async () => {
      throw new Error('502 from GET pulls/39')
    }
    await expect(syncCheck(deps)).rejects.toThrow('sync check failed for epic #2: 502 from GET pulls/39')
  })
})

describe('restGitHub sync calls', () => {
  const stub = (responses: unknown[]) => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(`${init?.method} ${String(url).replace('https://api.github.com', '')}`)
      return new Response(JSON.stringify(responses.shift() ?? {}), { status: 200 })
    })
    return urls
  }
  const pull: EpicPull = { number: 39, url: '', draft: true, nodeId: 'PR_39', head: 'epic/2' }
  const sleeps: number[] = []
  const github = () => restGitHub('token', 'vibing-out/vbt', { sleep: async (ms) => void sleeps.push(ms) })

  it('polls mergeable until GitHub has computed it', async () => {
    const urls = stub([{ mergeable: null }, { mergeable: null }, { mergeable: false }])
    try {
      expect(await github().mergeable(pull)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(urls).toEqual(Array(3).fill('GET /repos/vibing-out/vbt/pulls/39'))
  })
  it('gives up as unknown after six polls', async () => {
    const urls = stub(Array(10).fill({ mergeable: null }))
    try {
      expect(await github().mergeable(pull)).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(urls).toHaveLength(6)
  })
  it('lists only this repository\'s epic branches as epic pull requests', async () => {
    const head = (ref: string, repo = 'vibing-out/vbt') => ({ ref, repo: { full_name: repo } })
    stub([[
      { number: 39, html_url: 'u39', draft: true, node_id: 'PR_39', head: head('epic/2') },
      { number: 54, html_url: 'u54', draft: false, node_id: 'PR_54', head: head('factory/actions-runner') },
      { number: 70, html_url: 'u70', draft: false, node_id: 'PR_70', head: head('epic/9', 'someone/fork') },
    ]])
    try {
      expect(await github().openEpicPulls()).toEqual([{ number: 39, url: 'u39', draft: true, nodeId: 'PR_39', head: 'epic/2', epic: 2 }])
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('creates a sub-issue without a dependency when nothing blocks it', async () => {
    const urls = stub([{ id: 900, number: 60 }, {}])
    try {
      expect(await github().createSubIssue({ title: 'T-00a Sync epic/2 with main', body: 'b', epic: 2 })).toBe(60)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(urls).toEqual(['POST /repos/vibing-out/vbt/issues', 'POST /repos/vibing-out/vbt/issues/2/sub_issues'])
  })
})

describe('refreshRollup', () => {
  // E1 (#2) holds T-02 (#11, merged as #37) and T-04 (#12, open); its epic pull request is #39.
  const setup = () => {
    const e1: Issue = { ...ref(2, 'E1 Foundation', 'OPEN', ['epic']), parent: null, subIssues: [ref(11, 'T-02 Domain', 'CLOSED'), ref(12, 'T-04 Schema')], blockedBy: [], blocking: [] }
    const github = fakeGitHub([e1], undefined, undefined, { number: 39, url: 'u', draft: true, nodeId: 'PR_39', head: 'epic/2' })
    github.issueBodies = { 2: '### Outcome\n\nA page deploys.', 11: '### How to verify in the browser\n\nOpen /.' }
    github.merged = [
      { number: 37, url: 'u37', body: 'Ticket: #11\n\n## Summary\nThe state machine.\n\n```context-log\n{"version": 1, "decisions": [], "corrections": []}\n```' },
      { number: 36, url: 'u36', body: 'No ticket line: setup work.' },
    ]
    const checked: string[] = []
    const lines: string[] = []
    const deps = { github, context: async (args: string[], body?: string) => (checked.push(`${args[0]} ${body?.split('\n')[0]}`), 'ok'), log: (l: string) => lines.push(l) }
    return { github, checked, lines, deps }
  }

  it('writes the roll-up after checking its context-log block', async () => {
    const { github, checked, lines, deps } = setup()
    expect(await refreshRollup(2, deps)).toBe('updated')
    expect(checked).toEqual(['check Closes #2'])
    expect(github.calls).toEqual(['find epic pull for #2', 'edit body #39: Closes #2'])
    expect(lines).toContain('epic #2: roll-up on #39 updated (2 ticket(s), 2 merged pull request(s))')
  })
  it('leaves an unchanged description alone', async () => {
    const { github, deps } = setup()
    let written = ''
    github.editPullBody = async (_n, body) => void (written = body)
    await refreshRollup(2, deps)
    github.detail.body = written
    github.calls.length = 0
    expect(await refreshRollup(2, deps)).toBe('unchanged')
    expect(github.calls).toEqual(['find epic pull for #2'])
  })
  it('does nothing without an epic pull request', async () => {
    const { github, deps } = setup()
    github.epicPull = async () => null
    expect(await refreshRollup(2, deps)).toBe('no-pull')
    expect(github.calls).toEqual([])
  })
  it('logs a failure instead of throwing, so a landing never fails over its description', async () => {
    const { github, lines, deps } = setup()
    const failing = { ...deps, context: async () => Promise.reject(new Error('expected one context-log block')) }
    expect(await refreshRollup(2, failing)).toBe('failed')
    expect(github.calls).toEqual(['find epic pull for #2'])
    expect(lines).toContain('epic #2: roll-up failed: expected one context-log block')
  })
})
