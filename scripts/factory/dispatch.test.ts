import { describe, expect, it, vi } from 'vitest'
import {
  check, contextComment, landed, notify, readiness, slackMessage, slackText, ticketNumber, trimmed, unblock, webhookUrl,
  type Blocker, type GitHub, type Issue, type IssueRef, type LabelNotice, type Pull,
} from './dispatch.ts'

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
function fakeGitHub(issues: Issue[], pull?: Pull, notice?: LabelNotice): GitHub & { calls: string[] } {
  const calls: string[] = []
  const byNumber = new Map(issues.map((i) => [i.number, i]))
  return {
    calls,
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
      for (const i of byNumber.values()) for (const b of i.blockedBy) if (b.number === n) b.state = 'CLOSED'
    },
    async labelNotice(n, label) {
      calls.push(`read notice #${n} ${label}`)
      if (!notice) throw new Error('no notice')
      return notice
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
    expect(github.calls).toEqual(['comment #12 ## Context from earlier tickets', 'label #12 +factory-ready', 'label #12 -blocked'])
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

describe('landed', () => {
  const pull: Pull = {
    number: 40,
    url: 'https://github.com/vibing-out/vbt/pull/40',
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

  it('ingests, closes the ticket and re-checks what it was blocking', async () => {
    const { github } = setup()
    const runs: string[] = []
    await landed(40, { github, context: async (args) => (runs.push(args[0] ?? ''), 'ok'), log: silent })
    expect(runs[0]).toBe('ingest')
    expect(github.calls).toEqual(['close #11', 'comment #12 ## Context from earlier tickets', 'label #12 +factory-ready', 'label #12 -blocked'])
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
    expect(github.calls).toEqual(['label #30 +blocked', 'comment #14 ## Context from earlier tickets', 'label #14 +factory-ready', 'label #14 -blocked'])
  })
  it('re-checks blocked issues waiting on any ticket in a closed epic, and only those', async () => {
    const github = setup('CLOSED')
    await unblock(2, deps(github))
    // #31 is open but not blocked (never queued), so it is left alone.
    expect(github.calls).toEqual([
      'comment #30 ## Context from earlier tickets',
      'label #30 +factory-ready',
      'label #30 -blocked',
      'comment #14 ## Context from earlier tickets',
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
        '*<https://github.com/vibing-out/vbt/issues/12|#12 T-04 Schema>*',
        '`needs-human` added by warp-agent',
        '<https://github.com/vibing-out/vbt/issues/12#issuecomment-1|Newest comment> by warp-agent:',
        '> Which table holds voters?',
        '> Should it be soft-deleted?',
      ].join('\n'),
    )
  })
  it('says so when the issue has no comments or the label has no actor', () => {
    expect(slackMessage(notice({ comment: null, labeledBy: null }))).toBe(
      ['*<https://github.com/vibing-out/vbt/issues/12|#12 T-04 Schema>*', '`needs-human` added by an unknown actor', '_No comments on the issue yet._'].join('\n'),
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
    expect(text).not.toMatch(/<!|@here|@channel/)
  })
  it('trims the comment to 1,500 characters without splitting an emoji', () => {
    expect(trimmed('short')).toBe('short')
    const long = trimmed('x'.repeat(2_000))
    expect(long).toBe(`${'x'.repeat(1_500)}…`)
    expect(trimmed(`${'x'.repeat(1_499)}😀😀`)).toBe(`${'x'.repeat(1_499)}😀…`)
    const quoted = slackMessage(notice({ comment: { author: 'a', body: 'y'.repeat(5_000), url: 'u' } })).split('\n').at(-1)
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
    const pull: Pull = { number: 40, url: 'https://github.com/vibing-out/vbt/pull/40', merged: true, base: 'epic/2', body: 'Ticket: #12', mergeCommit: 'a'.repeat(40) }
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
