// Renders an epic pull request's description (the "roll-up") from what is already on GitHub: the epic issue,
// its tickets, and each ticket's merged pull request into `epic/<k>`. Pure: no network, no clock. dispatch.ts
// `rollup` gathers the input and writes the body; it runs when the epic pull request is opened and again at
// every ticket landing, so the description is always current.
//
// Everything quoted here comes from issue and pull request text, so it is flattened to one line, `@` mentions
// are defused and code fences are removed: a quoted item can never ping someone or break the body's layout.

// `runs`: Warp and Actions run links from the pull request's body and comments (see runLinks).
export type RollupPull = { number: number; url: string; body: string; runs: string[] }
export type RollupTicket = {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  labels: string[]
  body: string // the ticket issue's body, for "How to verify in the browser"
  pulls: RollupPull[] // its merged pull requests into epic/<k>, oldest first
}
export type RollupInput = {
  epic: { number: number; title: string; body: string }
  tickets: RollupTicket[]
  pull: { number: number; headSha: string | null }
  previewUrl: string | null
  // The current description, whose hand-written notes (between NOTES_START and NOTES_END) are kept.
  previousBody: string
}

export const NOTES_START = '<!-- epic-notes:start -->'
export const NOTES_END = '<!-- epic-notes:end -->'
const ITEM_LIMIT = 300 // characters per quoted item
const LIST_LIMIT = 40 // items per section
export const BODY_LIMIT = 60_000 // GitHub rejects bodies over 65,536 characters

type Section = { heading: string; level: number; lines: string[] }

// Splits markdown at headings outside code fences, after removing HTML comments.
export function sections(markdown: string): Section[] {
  const out: Section[] = [{ heading: '', level: 0, lines: [] }]
  let fence = false
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const heading = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) out.push({ heading: heading[2]!.trim(), level: heading[1]!.length, lines: [] })
    else out.at(-1)!.lines.push(line)
  }
  return out
}

// A section's text, ending at a horizontal rule (issue templates and bots append footers after one).
const sectionText = (markdown: string, pattern: RegExp): string =>
  (sections(markdown).find((s) => pattern.test(s.heading))?.lines.join('\n') ?? '').split(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m)[0]!.trim()

// One safe line of quoted text: whitespace collapsed, fences and table pipes neutralized, and mentions
// defused outside code spans (an `@` inside backticks never mentions anyone, and an entity there would
// show literally).
export function quote(text: string, limit = ITEM_LIMIT): string {
  const flat = text.replace(/```+/g, '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
  const cut = flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat
  return cut
    .split('`')
    .map((part, i) => (i % 2 ? part : part.replace(/@(?=[A-Za-z0-9-])/g, '&#64;')))
    .join('`')
}

const bullets = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => /^\s*(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(l)?.[1]?.trim() ?? '')
    .filter((l) => l && !/^none\.?$/i.test(l))

// The pull request's own context-log entries: its decisions and the corrections review caught.
export function contextLog(body: string): { decisions: string[]; corrections: { claim: string; fix: string; detectedBy: string }[] } {
  const block = /^```context-log[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m.exec(body)?.[1]
  try {
    const parsed = JSON.parse(block ?? '') as { decisions?: { text?: unknown }[]; corrections?: Record<string, unknown>[] }
    return {
      decisions: (parsed.decisions ?? []).map((d) => String(d.text ?? '')).filter(Boolean),
      corrections: (parsed.corrections ?? []).map((c) => ({ claim: String(c.claim ?? ''), fix: String(c.fix ?? ''), detectedBy: String(c.detected_by ?? '') })),
    }
  } catch {
    return { decisions: [], corrections: [] }
  }
}

// What the pull request delivered: the first paragraph of its Summary, or its opening text. A paragraph that
// introduces a list ("...:") takes the list's first three items with it.
export function delivered(body: string): string {
  const all = sections(body)
  const summary = all.find((s) => /^summary\b/i.test(s.heading)) ?? all[0]!
  const lines = summary.lines.map((l) => l.trim()).filter((l) => !/^ticket:\s*#\d+/i.test(l))
  const start = lines.findIndex(Boolean)
  if (start === -1) return ''
  const isItem = (l: string): boolean => /^(?:[-*]|\d+[.)])\s+/.test(l)
  const item = (l: string): string => l.replace(/^(?:[-*]|\d+[.)])\s+/, '')
  if (isItem(lines[start]!)) return item(lines[start]!)
  const paragraph: string[] = []
  let i = start
  for (; i < lines.length && lines[i] && !isItem(lines[i]!); i++) paragraph.push(lines[i]!)
  const text = paragraph.join(' ')
  if (!text.endsWith(':')) return text
  const items = lines.slice(i).filter(Boolean)
  const list: string[] = []
  for (const l of items) {
    if (!isItem(l) || list.length === 3) break
    list.push(item(l).replace(/[.;]$/, ''))
  }
  return list.length ? `${text} ${list.join('; ')}${items.filter(isItem).length > 3 ? '; …' : ''}` : text
}

// Review rounds recorded under "Review log": "### Round <n>" headings, or "<n>." items under a "Rounds" heading.
export function reviewRounds(body: string): number {
  const all = sections(body)
  const start = all.findIndex((s) => /^review log\b/i.test(s.heading))
  if (start === -1) return 0
  let rounds = 0
  for (let i = start + 1; i < all.length && all[i]!.level > all[start]!.level; i++) {
    const s = all[i]!
    if (/^round\b/i.test(s.heading)) rounds++
    else if (/^rounds\b/i.test(s.heading)) rounds += s.lines.filter((l) => /^\s*\d+[.)]\s/.test(l)).length
  }
  return rounds
}

// Items a pull request left for the epic approver: bullets under an "epic approver" or "judgment" heading,
// and bullets marked as judgment calls. A judgment bullet that only introduces a nested list contributes
// the nested items instead.
export function approverItems(body: string): string[] {
  const items: string[] = []
  for (const s of sections(body)) {
    const forApprover = /epic approver|judgment/i.test(s.heading)
    let nestedUnder: number | null = null // the indent of a judgment bullet whose items follow, nested
    for (const line of s.lines) {
      const m = /^(\s*)(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line)
      if (!m) continue
      const indent = m[1]!.length
      const text = m[2]!.trim()
      if (nestedUnder !== null && indent > nestedUnder) {
        items.push(text)
        continue
      }
      nestedUnder = null
      const judgment = /^(?:\*\*|__)?judgment\b/i.test(text)
      const rest = judgment ? text.replace(/^(?:\*\*|__)?judgment[^:]*:(?:\*\*|__)?\s*/i, '').replace(/^(?:\*\*|__)\s*/, '').trim() : text
      if (judgment && !rest) nestedUnder = indent
      else if ((forApprover || judgment) && rest && !/^none\.?$/i.test(rest)) items.push(rest)
    }
  }
  return items
}

// Run links in a pull request body: Warp runs and GitHub Actions runs.
export function runLinks(body: string): string[] {
  const found = body.match(/https:\/\/(?:platform\.warp\.dev\/[\w-]+\/runs\/[\w-]+|github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+)/g) ?? []
  return [...new Set(found)]
}

// The hand-written notes in the current description, markers included, or null.
export function keptNotes(previousBody: string): string | null {
  const start = previousBody.indexOf(NOTES_START)
  const end = previousBody.indexOf(NOTES_END, start)
  return start !== -1 && end !== -1 ? previousBody.slice(start, end + NOTES_END.length) : null
}

const capped = (items: string[], empty: string): string[] =>
  items.length === 0 ? [empty] : items.length <= LIST_LIMIT ? items : [...items.slice(0, LIST_LIMIT), `- …and ${items.length - LIST_LIMIT} more.`]

export function epicRollup(input: RollupInput): string {
  const { epic, tickets, pull, previewUrl } = input
  const pulls = tickets.flatMap((t) => t.pulls)
  const merged = tickets.filter((t) => t.pulls.length)
  const open = tickets.filter((t) => t.state === 'OPEN')
  const blocked = tickets.filter((t) => t.state === 'OPEN' && t.labels.includes('needs-human'))

  const decisions = pulls.flatMap((p) => contextLog(p.body).decisions.map((d) => `- ${quote(d)} (#${p.number})`))
  const corrections = pulls.flatMap((p) =>
    contextLog(p.body).corrections.map((c) => `- ${quote(c.claim)} → ${quote(c.fix)} (${c.detectedBy ? `caught by ${quote(c.detectedBy, 40)}, ` : ''}#${p.number})`),
  )
  const approver = pulls.flatMap((p) => approverItems(p.body).map((i) => `- ${quote(i)} (#${p.number})`))
  const flows = tickets.flatMap((t) => {
    const steps = sectionText(t.body, /how to verify/i)
    // "None (no screen)" and the like mean the ticket has no browser check.
    return steps && !/^(?:_?none\b|n\/a\b)/i.test(steps) ? [`- **#${t.number} ${quote(t.title, 80)}:** ${quote(steps, 500)}`] : []
  })
  const focus = bullets(sectionText(epic.body, /^review focus\b/i)).map((f) => `- [ ] ${quote(f)}`)
  const runs = pulls.flatMap((p) => (p.runs.length ? [`- #${p.number}: ${p.runs.map((l, i) => `[run ${i + 1}](${l})`).join(' · ')}`] : []))
  const risks = [
    ...open.map((t) => `- #${t.number} ${quote(t.title, 80)} is still open${t.labels.includes('needs-human') ? ' and waits on a person (`needs-human`)' : ''}.`),
    ...(approver.length ? [`- The ${approver.length} approver item(s) above are undecided until someone answers them.`] : []),
    ...(focus.length ? ['- The review focus items above need a reviewer\'s evidence; this description does not prove them.'] : []),
    ...(pulls.some((p) => reviewRounds(p.body) === 0) ? ['- Some pull requests record no review rounds (see the table).'] : []),
  ]

  const status = !tickets.length
    ? 'No tickets yet'
    : open.length
      ? `${merged.length} of ${tickets.length} tickets merged into \`epic/${epic.number}\`; ${open.length} open${blocked.length ? `, ${blocked.length} waiting on a person` : ''}`
      : `All ${tickets.length} tickets merged into \`epic/${epic.number}\``

  const body = [
    `Closes #${epic.number}`,
    '',
    `# ${quote(epic.title, 120)}`,
    '',
    sectionText(epic.body, /^outcome\b/i) || `The epic issue #${epic.number} has no Outcome section yet.`,
    '',
    `**Status:** ${status}. **Preview:** ${previewUrl ?? 'not deployed yet'}. **Head:** \`${pull.headSha?.slice(0, 7) ?? `epic/${epic.number}`}\`.`,
    '',
    '## Tickets',
    '',
    '| Ticket | Pull request | What it delivered | Review rounds |',
    '|---|---|---|---|',
    ...(tickets.length
      ? tickets.map((t) =>
          t.pulls.length
            ? `| #${t.number} ${quote(t.title, 80)} | ${t.pulls.map((p) => `#${p.number}`).join(', ')} | ${t.pulls.map((p) => quote(delivered(p.body))).filter(Boolean).join(' ') || '—'} | ${t.pulls.map((p) => reviewRounds(p.body)).join(' + ') || '—'} |`
            : `| #${t.number} ${quote(t.title, 80)} | — | ${t.state === 'OPEN' ? 'In progress' : 'Closed without a merged pull request'} | — |`,
        )
      : ['| — | — | — | — |']),
    '',
    '## Decisions made',
    '',
    ...capped(decisions, 'None logged yet.'),
    '',
    '## Corrections caught by review',
    '',
    ...capped(corrections, 'None logged yet.'),
    '',
    '## For the epic approver',
    '',
    ...capped(approver, 'Nothing yet.'),
    '',
    '## How to test it',
    '',
    previewUrl
      ? `Preview: ${previewUrl}. It is behind Vercel deployment protection: sign in to Vercel first, or send the \`x-vercel-protection-bypass\` header.`
      : 'No preview deployment yet.',
    '',
    ...capped(flows, 'The tickets list no browser checks yet.'),
    '',
    `### Review focus (from #${epic.number})`,
    '',
    ...capped(focus, 'The epic issue lists no review focus.'),
    '',
    '## Risks',
    '',
    ...capped(risks, 'None known.'),
    '',
    '## Run links',
    '',
    ...capped(runs, 'No run links in the merged pull requests.'),
    '',
    '## Notes',
    '',
    keptNotes(input.previousBody) ?? `${NOTES_START}\nWrite anything that should survive refreshes between these markers.\n${NOTES_END}`,
    '',
    '---',
    `Written by \`dispatch.ts rollup\` and refreshed at every ticket landing; edit only the Notes. Each ticket's decisions and corrections were logged when it merged into \`epic/${epic.number}\`, so this block adds none.`,
    '',
    '```context-log',
    '{"version": 1, "decisions": [], "corrections": []}',
    '```',
  ].join('\n')
  if (body.length > BODY_LIMIT) throw new Error(`the roll-up for #${epic.number} is ${body.length} characters, over ${BODY_LIMIT}`)
  return body
}

// The Vercel preview URL from the Vercel bot's comments on the epic pull request, or null.
export function previewUrl(comments: { author: string | null; body: string }[]): string | null {
  for (const c of [...comments].reverse()) {
    if (!/^vercel/i.test(c.author ?? '')) continue
    const host = /https:\/\/([a-z0-9-]+\.vercel\.app)\b/i.exec(c.body)?.[1]
    if (host) return `https://${host.toLowerCase()}`
  }
  return null
}
