// Checks and renders the factory's review and epic-verification reports, so every report comment says
// what was checked, how it was tested, what was found, and how confident the reviewer is. No dependencies
// and no model: an agent writes the report body, and this script decides whether it is complete and
// what its verdict is.
//   node scripts/factory/report.ts check <review|verify> < body.md
//   node scripts/factory/report.ts render <review|verify> --title "Review round 2" [--models "CLAUDE_MODELS=..."] [--run <url>] < body.md
//   node scripts/factory/report.ts summary < comment.md
// `check` prints each problem and exits 1. `render` prints the comment to post, or the problems and exits 1.
// `summary` prints the Summary section, for the Foreman's outcome comment on the ticket.
//
// The body an agent writes (### sections, in this order):
//   ### What was checked            a table: | Criterion | Result | Evidence |, Result is pass, fail or unverified
//   ### Tests                       what ran with counts ("111 passed"), new tests, or a "Not run:" line with why
//   ### QA performed                what was exercised and how (preview URL, SQL or row-level security probes, edge cases)
//   ### Security and locked interfaces
//   ### Findings                    review: #### Unambiguous fixes and #### Judgment calls for a human
//                                   each item tagged [high|medium|low, open|fixed], or the word none
//   ### Decisions                   review only: one {"text": ...} line per resolved question, or none
//   ### Summary                     3 to 5 bullets: what this delivers, confidence and why, what is left
// The verdict is derived, never written by the agent: an open unambiguous fix means "fixes needed", an open
// judgment call means "approver decisions", otherwise "clean". A failed criterion must have an open finding.

export type Kind = 'review' | 'verify'
type Section = { title: string; lines: string[] }
type Finding = { group: string; severity: string; status: 'open' | 'fixed'; text: string }

const COMMENT_LIMIT = 60_000 // GitHub rejects comments over 65,536 characters
const SECTIONS: Record<Kind, string[]> = {
  review: ['What was checked', 'Tests', 'QA performed', 'Security and locked interfaces', 'Findings', 'Decisions', 'Summary'],
  verify: ['What was checked', 'Tests', 'QA performed', 'Security and locked interfaces', 'Findings', 'Summary'],
}
const FINDING_GROUPS: Record<Kind, string[]> = {
  review: ['Unambiguous fixes', 'Judgment calls for a human'],
  verify: [],
}
const RESULTS = ['pass', 'fail', 'unverified']
const TAG = /\[(high|medium|low)\s*,\s*(open|fixed)\]/i
const ITEM = /^(?:[-*]|\d+[.)])\s+/ // a top-level list item; indented sub-items are details of the item above
const TEST_COUNT = /\b\d+\s+(passed|failed)\b/i

const isBlank = (lines: string[]) => lines.every(line => line.trim() === '' || /^none\.?$/i.test(line.trim()))
const saysNone = (lines: string[]) => lines.some(line => /^none\.?$/i.test(line.trim()))
const content = (lines: string[]) => lines.filter(line => line.trim() !== '')

// Splits markdown into sections by headings of the given level. Text before the first heading is ignored.
function split(lines: string[], level: number): Section[] {
  const marker = new RegExp(`^#{${level}}\\s+(.+?)\\s*#*\\s*$`)
  const sections: Section[] = []
  for (const line of lines) {
    const heading = marker.exec(line)
    if (heading) sections.push({ title: heading[1]!.trim(), lines: [] })
    else sections.at(-1)?.lines.push(line)
  }
  return sections
}

function tableRows(lines: string[]): string[][] {
  return lines
    .filter(line => line.trim().startsWith('|'))
    .map(line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()))
    .filter(cells => !cells.every(cell => /^:?-+:?$/.test(cell))) // the separator row
    .slice(1) // the header row
}

function findings(lines: string[], group: string, errors: string[]): Finding[] {
  const items = lines.filter(line => ITEM.test(line))
  if (items.length === 0) {
    if (!saysNone(lines)) errors.push(`Findings > ${group}: list each finding, or write "none"`)
    return []
  }
  return items.flatMap(item => {
    const tag = TAG.exec(item)
    if (!tag) {
      errors.push(`Findings > ${group}: tag this item [high|medium|low, open|fixed]: ${item.trim().slice(0, 80)}`)
      return []
    }
    return [{ group, severity: tag[1]!.toLowerCase(), status: tag[2]!.toLowerCase() as Finding['status'], text: item }]
  })
}

export type Checked = { errors: string[]; verdict: string; failed: number; findings: Finding[] }

export function check(body: string, kind: Kind): Checked {
  const errors: string[] = []
  const sections = split(body.split('\n'), 3)
  const expected = SECTIONS[kind]
  const titles = sections.map(section => section.title)
  for (const title of titles) if (!expected.includes(title)) errors.push(`unexpected section "### ${title}"`)
  for (const title of expected) {
    const count = titles.filter(t => t === title).length
    if (count === 0) errors.push(`missing section "### ${title}"`)
    if (count > 1) errors.push(`section "### ${title}" appears ${count} times`)
  }
  const order = expected.filter(title => titles.includes(title))
  const seen = order.slice().sort((a, b) => titles.indexOf(a) - titles.indexOf(b))
  if (seen.join() !== order.join()) errors.push(`sections must be in this order: ${expected.join(', ')}`)
  const get = (title: string) => sections.find(section => section.title === title)?.lines ?? []
  for (const title of expected) {
    if (titles.includes(title) && title !== 'Findings' && title !== 'Decisions' && isBlank(get(title))) errors.push(`section "${title}" is empty`)
  }

  // What was checked: every criterion row has a result and evidence.
  const rows = tableRows(get('What was checked'))
  if (titles.includes('What was checked') && rows.length === 0) errors.push('What was checked: add a | Criterion | Result | Evidence | table with one row per criterion')
  let failed = 0
  for (const cells of rows) {
    const [criterion = '', result = '', evidence = ''] = cells
    if (!RESULTS.includes(result.toLowerCase())) errors.push(`What was checked: result must be pass, fail or unverified, not "${result}" (${criterion.slice(0, 60)})`)
    if (cells.length < 3 || evidence === '') errors.push(`What was checked: no evidence for "${criterion.slice(0, 60)}"`)
    if (result.toLowerCase() === 'fail') failed++
  }

  // Tests: counts from what ran, or an honest "Not run:".
  const tests = get('Tests')
  if (titles.includes('Tests') && !isBlank(tests) && !tests.some(line => TEST_COUNT.test(line) || /^\W*not run:/i.test(line.trim()))) {
    errors.push('Tests: give counts from what ran (for example "111 passed, 0 failed"), or a "Not run:" line saying why')
  }

  // Findings: grouped for review, flat for verify; every item tagged with severity and status.
  const found: Finding[] = []
  if (titles.includes('Findings')) {
    const groups = FINDING_GROUPS[kind]
    if (groups.length === 0) found.push(...findings(get('Findings'), 'Findings', errors))
    else {
      const subsections = split(get('Findings'), 4)
      for (const group of groups) {
        const sub = subsections.find(section => section.title === group)
        if (!sub) errors.push(`Findings: missing "#### ${group}"`)
        else found.push(...findings(sub.lines, group, errors))
      }
    }
  }

  // Decisions: one JSON object per line, or none.
  if (kind === 'review' && titles.includes('Decisions')) {
    const lines = content(get('Decisions'))
    if (lines.length === 0) errors.push('Decisions: list each decision as {"text": ...}, or write "none"')
    else if (!saysNone(lines)) {
      for (const line of lines) {
        const json = line.replace(ITEM, '').replace(/^`+|`+$/g, '').trim()
        try {
          const parsed: unknown = JSON.parse(json)
          if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { text?: unknown }).text !== 'string') throw new Error()
        } catch {
          errors.push(`Decisions: each line must be {"text": "..."}: ${line.trim().slice(0, 80)}`)
        }
      }
    }
  }

  // Summary: 3 to 5 bullets.
  const bullets = get('Summary').filter(line => ITEM.test(line))
  if (titles.includes('Summary') && (bullets.length < 3 || bullets.length > 5)) errors.push(`Summary: write 3 to 5 bullets, not ${bullets.length}`)

  const open = found.filter(finding => finding.status === 'open')
  if (failed > 0 && open.length === 0) errors.push('a criterion failed but no finding is open: add the open finding that fixes it')
  const verdict = kind === 'verify'
    ? (failed > 0 || open.length > 0 ? 'fail' : 'pass')
    : open.some(finding => finding.group === 'Unambiguous fixes') ? 'fixes needed'
    : open.length > 0 ? 'approver decisions'
    : 'clean'
  return { errors, verdict, failed, findings: found }
}

export type RenderOptions = { kind: Kind; title: string; models?: string; run?: string }

export function render(body: string, options: RenderOptions): { errors: string[]; comment: string } {
  const result = check(body, options.kind)
  const errors = [...result.errors]
  if (options.kind === 'review' && !options.models?.startsWith('CLAUDE_MODELS=')) errors.push('--models must be the CLAUDE_MODELS= line review printed')
  if (options.run !== undefined && !/^https:\/\/\S+$/.test(options.run)) errors.push('--run must be the Warp run URL')
  const open = result.findings.filter(finding => finding.status === 'open')
  const counts = `${open.length} open, ${result.findings.length - open.length} fixed`
  const comment = [
    `## ${options.title}: ${result.verdict}`,
    '',
    ...(options.models ? [options.models, ''] : []),
    `Findings: ${counts}. Criteria failed: ${result.failed}.`,
    '',
    body.trim(),
    ...(options.run ? ['', `Warp run: ${options.run}`] : []),
    '',
  ].join('\n')
  if (comment.length > COMMENT_LIMIT) errors.push(`the comment is ${comment.length} characters; GitHub allows ${COMMENT_LIMIT}`)
  return { errors, comment: errors.length > 0 ? '' : comment }
}

export function summary(comment: string): string {
  const section = split(comment.split('\n'), 3).find(s => s.title === 'Summary')
  return section ? section.lines.filter(line => ITEM.test(line)).join('\n') : '' // bullets only: the run link follows the section
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const USAGE = 'usage: node report.ts <check <review|verify> | render <review|verify> --title <t> [--models <line>] [--run <url>] | summary> < file'

if (import.meta.main) {
  const [command, kindArg, ...rest] = process.argv.slice(2)
  const kind = kindArg as Kind
  const needsKind = command === 'check' || command === 'render'
  if (!command || !['check', 'render', 'summary'].includes(command) || (needsKind && kind !== 'review' && kind !== 'verify')) {
    console.error(USAGE)
    process.exit(2)
  }
  const input = await stdin()
  if (command === 'summary') {
    const text = summary(input)
    if (!text) { console.error('no "### Summary" section'); process.exit(1) }
    console.log(text)
  } else if (command === 'check') {
    const { errors, verdict } = check(input, kind)
    for (const error of errors) console.error(`- ${error}`)
    if (errors.length > 0) process.exit(1)
    console.log(`ok: ${verdict}`)
  } else {
    const title = flag(rest, '--title')
    if (!title) { console.error(USAGE); process.exit(2) }
    const { errors, comment } = render(input, { kind, title, models: flag(rest, '--models'), run: flag(rest, '--run') })
    for (const error of errors) console.error(`- ${error}`)
    if (errors.length > 0) process.exit(1)
    process.stdout.write(comment)
  }
}
