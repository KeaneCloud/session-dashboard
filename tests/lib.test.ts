// Pure-logic tests: time strings, description sanitizing, same-titled steps, latest 5 steps, status lights, other-session rows, Svg, names and paths
import { expect, test } from 'claude-code/testing'
import { setLang } from '../hooks/i18n.js'

// English is the default UI language; set it explicitly so the suite does not depend on test order
setLang('en')
import {
  isProjectSession, projectTag, clientRowMode, ago, bar, currentStepLabel, desktopRecordMatches, estimateRemainingMin, etaText, folderName, formatElapsed,
  jumpUrl, limitColor, liveSessions, mergeProgress, othersRows, parseTaskSteps, pushAction, relativeReset, rightTime,
  safeText, actionLabel, showActivity, splitHidden, statusOf, stepStats, summarizeBackground, svgOtherLine,
  svgSectionDivider, svgThinBar, svgTimelineNode, tasksPath, thinBar, titleFromTranscript, usageRows, usageSegments,
  fitSteps, ROWS, timelineItems, svgSessionGap, cleanTitle, nameUnits, LIGHT, wrapByWidth, cleanStepText, touchesChecklist, nodeHeight,
} from '../hooks/lib.js'

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime()
const MIN = 60_000
const S = (statuses: string[]) => statuses.map((s, i) => ({ title: 'S' + i, status: s }))

test('times use abbreviated English: remaining, how long ago, elapsed, reset', () => {
  expect([etaText(null), etaText(0), etaText(18), etaText(75), etaText(120)]).toEqual(['', 'done', '~18m', '~1h 15m', '~2h'])
  expect([ago(0, 30_000), ago(0, 40 * MIN), ago(0, 125 * MIN), ago(0, 27 * 60 * MIN), ago(0, 24 * 60 * MIN)])
    .toEqual(['just now', '40m ago', '2h ago', '1d ago', '1d ago']) // the largest unit only
  expect([formatElapsed(72_000), formatElapsed(9_400)]).toEqual(['1m 12s', '9s'])
  const now = local(2026, 10, 7, 17, 0) // a Wednesday
  expect(relativeReset(new Date(local(2026, 10, 7, 17, 25)).toISOString(), now)).toBe('resets in 25m')
  expect(relativeReset(new Date(local(2026, 10, 7, 19, 10)).toISOString(), now)).toBe('resets in 2h')
  expect(relativeReset(new Date(local(2026, 10, 9, 9, 0)).toISOString(), now)).toBe('resets Fri')
  expect(relativeReset(undefined, now)).toBe('')
})

test('usage: Session limit first, Weekly limit second; colors go blue → orange → red', () => {
  const now = local(2026, 10, 7, 17, 0)
  const segs = usageSegments([{ kind: 'seven_day', percentUsed: 87, resetsAt: new Date(local(2026, 10, 9, 9, 0)).toISOString() }, { kind: 'five_hour', percentUsed: 64 }, { kind: 'spend_limit', percentUsed: 1 }], now)
  expect(segs.map((s) => [s.label, s.pct, s.reset])).toEqual([['Session limit', 64, ''], ['Weekly limit', 87, 'resets Fri']])
  expect([limitColor(64), limitColor(82), limitColor(85), limitColor(86)]).toEqual(['#0088b0', '#e07a10', '#e07a10', '#c8222b'])
  expect([usageRows(2), usageRows(0)]).toEqual([5, 1])
})

test('description sanitizing: paths, commands and keys become a generic name; clean short descriptions pass through', () => {
  setLang('en')
  for (const bad of ['Read C:\\Users\\x', 'cat /etc/passwd/', 'ls | grep x', 'a && b', 'TOKEN=abc', 'npm test --watch', ['sk', 'live', 'x'.repeat(24)].join('_')]) {
    expect(safeText(bad, 'X')).toBe('X')
  }
  expect(safeText('Run tests', 'X')).toBe('Run tests')
  expect(safeText('', 'X')).toBe('X')
  expect(actionLabel({ tool: 'Bash', description: 'Test C:\\work' })).toBe('Run a command')
  expect(actionLabel({ tool: 'Bash', description: 'Run tests' })).toBe('Run: Run tests')
  expect(actionLabel({ tool: 'Agent', description: 'cd /a/b/ look things up' })).toBe('Start a subagent')
  expect(actionLabel({ tool: 'Edit', file_path: 'C:\\a\\b\\x.js' })).toBe('Edit x.js')
  expect(summarizeBackground([{ type: 'shell', description: 'python /x/y/run.py' }])).toEqual({ count: 1, current: 'Background command' })
  expect(summarizeBackground([{ type: 'shell', description: 'Run benchmark' }, { type: 'subagent' }])).toEqual({ count: 2, current: 'Run benchmark' })
  expect(summarizeBackground([])).toBe(null)
})

test('same-titled steps each keep their own timing', () => {
  const t0 = 1_000_000
  let p = mergeProgress(null, { steps: [{ title: 'Test', status: 'done' }, { title: 'Test', status: 'running' }] }, t0)
  p = mergeProgress(p, { steps: [{ title: 'Test', status: 'done' }, { title: 'Test', status: 'done' }] }, t0 + 5 * MIN)
  expect(p.steps.map((s) => s.doneAt)).toEqual([t0, t0 + 5 * MIN])
})

test('mergeProgress: start/done times, a new task restarts the timer, unknown statuses become todo', () => {
  const t0 = 1_000_000
  const p1 = mergeProgress(null, { task: 'Deploy', steps: [{ title: 'A', status: 'running' }, { title: 'B', status: 'todo' }] }, t0)
  expect(p1).toMatchObject({ task: 'Deploy', startedAt: t0, steps: [{ title: 'A', status: 'running', startedAt: t0 }, { title: 'B', status: 'todo' }] })
  const p2 = mergeProgress(p1, { steps: [{ title: 'A', status: 'done' }, { title: 'B', status: 'bad', note: ' broken ' }] }, t0 + 5 * MIN)
  expect(p2.steps).toEqual([
    { title: 'A', status: 'done', note: undefined, startedAt: t0, doneAt: t0 + 5 * MIN },
    { title: 'B', status: 'bad', note: 'broken', startedAt: t0 + 5 * MIN, doneAt: undefined },
  ])
  const p3 = mergeProgress(p2, { steps: [{ title: 'X', status: 'running' }, { title: 'Y', status: 'bogus' }] }, t0 + 9 * MIN)
  expect([p3.startedAt, p3.task, p3.steps[1].status]).toEqual([t0 + 9 * MIN, undefined, 'todo'])
})

test('estimated remaining time', () => {
  const t0 = 1_000_000
  let p = mergeProgress(null, { steps: S(['running', 'todo', 'todo', 'todo']) }, t0)
  expect(estimateRemainingMin(p, t0 + MIN)).toBe(null)
  p = mergeProgress(p, { steps: S(['done', 'done', 'running', 'todo']) }, t0 + 6 * MIN)
  expect(estimateRemainingMin(p, t0 + 6 * MIN)).toBe(6)
})

test('TASKS.md: BLOCKED = warn, CRITICAL (or 嚴重) = bad, the first [ ] = running', () => {
  // The 嚴重 line checks the Chinese keyword and the full-width colon
  const md = ['- [x] Read data', '- [ ] Fetch records BLOCKED: key expired', '- [ ] 編譯 嚴重：型別錯誤', '- [ ] Compute totals', '* [ ] Draw chart'].join('\r\n')
  expect(parseTaskSteps(md)).toEqual([
    { title: 'Read data', status: 'done' },
    { title: 'Fetch records', status: 'warn', note: 'key expired' },
    { title: '編譯', status: 'bad', note: '型別錯誤' },
    { title: 'Compute totals', status: 'running' },
    { title: 'Draw chart', status: 'todo' },
  ])
  expect(parseTaskSteps('- [ ] Build CRITICAL: type error\n- [ ] Deploy BLOCKED: needs approval')).toEqual([
    { title: 'Build', status: 'bad', note: 'type error' },
    { title: 'Deploy', status: 'warn', note: 'needs approval' },
  ])
})

test('latest 5 steps: centered on the current step, done steps collapse, "N more" counts only unfinished steps', () => {
  // Scenario: 34 done steps, then a running one, 3 todo steps, then another stretch of done steps
  const steps = [...S(Array(34).fill('done')), { title: 'R', status: 'running' }, { title: 'T1', status: 'todo' }, { title: 'T2', status: 'todo' }, { title: 'T3', status: 'todo' }, ...S(Array(10).fill('done'))]
  const r = fitSteps(steps, 99)
  expect(r.shown.map((x) => x.step.title)).toEqual(['S32', 'S33', 'R', 'T1', 'T2'])
  expect(r.doneCollapsed).toBe(42) // 44 done minus the 2 that are shown
  expect(r.more).toBe(1) // only T3 is unfinished and not shown
  // With an unfinished warn step earlier in the list, the running step is still the center (not the first unfinished one)
  const mixed = [{ title: 'W', status: 'warn' }, ...S(Array(8).fill('done')), { title: 'R', status: 'running' }, ...S(['todo', 'todo', 'todo'])]
  expect(fitSteps(mixed, 99).shown.map((x) => x.step.title)).toEqual(['S6', 'S7', 'R', 'S0', 'S1'])
  // At an edge: when the current step is first, the window extends forward
  expect(fitSteps(S(['running', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']), 99).shown.map((x) => x.index)).toEqual([0, 1, 2, 3, 4])
  // Not enough room: shrink from the end farthest from the center; the current step always stays
  // The "N done" / "N more" entries are timeline nodes too and take ROWS.step rows each
  const small = fitSteps(steps, 3 * ROWS.step)
  expect(small.shown.map((x) => x.step.title)).toEqual(['R'])
  // Everything done: only the collapsed "done" row remains
  expect(fitSteps(S(['done', 'done']), 99)).toEqual({ doneCollapsed: 2, shown: [], more: 0 })
})

test('status lights: bad > warn > working (incl. background) > finished unread > idle', () => {
  expect(statusOf({ stats: { hasBad: true, hasWarn: true }, isWorking: true })).toBe('bad')
  expect(statusOf({ stats: { hasWarn: true }, isWorking: true })).toBe('warn')
  expect(statusOf({ isWorking: true })).toBe('working')
  expect(statusOf({ background: { count: 1 } })).toBe('working')
  expect(statusOf({ finishedAt: 100, lastFocusedAt: 50 })).toBe('unread')
  expect([LIGHT.warn, LIGHT.bad, LIGHT.unread]).toEqual(['#c8222b', '#c8222b', '#e07a10']) // problems are always red, finished-unread is orange
  expect(statusOf({ finishedAt: 100, lastFocusedAt: 150 })).toBe('idle') // opened and seen afterwards
  expect(statusOf({ finishedAt: 100, seenAt: 100 })).toBe('idle') // was open and visible when it finished
  expect(statusOf({})).toBe('idle')
})

test('right-side time: remaining time while working, time since finishing once stopped (not the heartbeat time)', () => {
  const now = 10 * 60 * MIN
  expect(rightTime({ isWorking: true, hasToolSteps: true, eta: '~18m' }, now)).toBe('~18m')
  expect(rightTime({ isWorking: true }, now)).toBe('')
  expect(rightTime({ finishedAt: now - 40 * MIN, lastSeen: now }, now)).toBe('40m ago')
  expect(rightTime({ lastSeen: now }, now)).toBe('') // no finish time means no text, instead of a permanent "just now"
})

test('other-session rows: 1 divider + 2 each + 1 blank between + 1 for "N more"', () => {
  expect([othersRows(0, 3), othersRows(3, 3), othersRows(4, 9)]).toEqual([0, 9, 13]) // one blank row between sessions
})

test('Svg: timeline nodes, stretched progress bar, faint line between sessions, thick divider with embedded title', () => {
  const run = svgTimelineNode('running', '4', '#ffffff40', '#ffffff40')
  expect(run).toContain('fill-opacity="0.25"') // halo around the running node
  expect(run).toContain('>4</text>')
  expect(run.match(/<rect /g)?.length).toBe(2) // upper and lower line segments
  const first = svgTimelineNode('done', '✓', null, '#2f8f4e')
  expect(first).not.toContain('y="0"') // the first node has no upper line
  expect(first).toContain('fill="#2f8f4e"/>')
  const last = svgTimelineNode('more', '…', '#ffffff40', null)
  expect(last.match(/<rect /g)?.length).toBe(1) // the last node has no lower line
  expect(last).toContain('stroke-dasharray="3 3"')
  expect(svgTimelineNode('todo', '5', 'a', 'b')).toContain('stroke="#a9a5a3"') // hollow gray circle
  expect(svgTimelineNode('bad', '!', null, null)).toContain('fill="#c8222b"/>')
  expect(svgThinBar(50, '#0088b0', 200)).toContain('<rect width="100" height="4" fill="#0088b0"/>')
  expect(svgOtherLine(75)).toContain('width="210" height="4" rx="2" fill="#0088b0"') // 75% of 280px, same width as the usage bars
  expect(svgOtherLine(null)).not.toContain('<rect')
  expect(svgSessionGap()).toContain('fill="#ffffff18"')
  const div = svgSectionDivider('Other sessions')
  expect(div).toContain('>Other sessions</text>')
  expect(div.match(/height="3"/g)?.length).toBe(2)
})

test('timeline node order and line colors: green between done nodes, gray elsewhere, none at either end', () => {
  const steps = [...S(['done', 'done', 'done']), { title: 'R', status: 'running' }, ...S(['todo', 'todo', 'todo', 'todo'])]
  const items = timelineItems(fitSteps(steps, 99))
  expect(items.map((x) => [x.kind, x.label])).toEqual([['collapsed', '✓'], ['done', '✓'], ['done', '✓'], ['running', '4'], ['todo', '5'], ['todo', '6'], ['more', '…']])
  expect(items.map((x) => [x.top, x.bottom])).toEqual([
    [null, '#2f8f4e'], ['#2f8f4e', '#2f8f4e'], ['#2f8f4e', '#ffffff40'], ['#ffffff40', '#ffffff40'],
    ['#ffffff40', '#ffffff40'], ['#ffffff40', '#ffffff40'], ['#ffffff40', null],
  ])
  expect(timelineItems(fitSteps(S(['running']), 99)).map((x) => [x.top, x.bottom])).toEqual([[null, null]])
})

test('name cleanup and length units: quotes and punctuation stripped, a CJK character or an English word counts as 1', () => {
  // CJK sample data on purpose: this test covers CJK quotes, punctuation and unit counting
  expect(cleanTitle('「文件網站重新設計」。')).toBe('文件網站重新設計') // never truncated
  expect([nameUnits('Session dashboard 間距調整'), nameUnits('Docs mod'), nameUnits('文件網站')]).toEqual([6, 2, 4])
  expect(cleanTitle('Mod 面板改版\n說明')).toBe('Mod 面板改版')
  expect(cleanTitle('"面板"')).toBe('面板')
})

test('jump links, Desktop records, names, paths, lists, hiding', () => {
  expect(jumpUrl('local_2f5f-db89')).toBe('claude://claude.ai/epitaxy/local_2f5f-db89')
  expect(jumpUrl('local_x&rm')).toBe(null)
  expect(desktopRecordMatches({ cliSessionId: 'b', priorCliSessionIds: ['a'] }, 'a')).toBe(true)
  expect(titleFromTranscript('{"type":"ai-title","aiTitle":"A"}\n{"type":"custom-title","customTitle":"B"}')).toBe('B')
  expect(folderName('C:\\x\\proj\\')).toBe('proj')
  expect(tasksPath('/h/p')).toBe('/h/p/TASKS.md')
  expect(liveSessions([{ id: 'b', lastSeen: 9, firstSeen: 2 }, { id: 'a', lastSeen: 9, firstSeen: 1 }, { id: 'old', lastSeen: 0, firstSeen: 0 }], 10, 5).map((s) => s.id)).toEqual(['a', 'b'])
  expect(splitHidden([{ id: 'a' }, { id: 'c', lastFocusedAt: 200 }], { a: { at: 1 }, c: { at: 100 } })).toEqual({ visible: [{ id: 'c', lastFocusedAt: 200 }], hiddenCount: 1, unhide: ['c'] })
  expect([bar(50, 4), thinBar(50, 4)]).toEqual(['▓▓░░', '▰▰▱▱'])
  expect(currentStepLabel(S(['done', 'running']))).toBe('S1')
  expect(stepStats([{ status: 'bad' }, { status: 'done' }])).toEqual({ done: 1, total: 2, pct: 50, hasWarn: true, hasBad: true })
  expect(pushAction(pushAction([], 'a', 0), 'b', 0).map((x) => x.label)).toEqual(['b', 'a'])
  expect(showActivity({ startedAt: 0 }, false, 60_000)).toBe(true)
})

test('wrapByWidth: wraps by display width (a CJK character takes 2 cells) and drops no characters', () => {
  expect(wrapByWidth('abc', 10)).toEqual(['abc'])
  expect(wrapByWidth('面板間距調整設定', 8)).toEqual(['面板間距', '調整設定'])
  expect(wrapByWidth('Dashboard 間距調整', 10).join('')).toBe('Dashboard 間距調整')
})

test('cleanStepText: drops URLs (with their brackets) and backticks from checklist items', () => {
  expect(cleanStepText('Install the DevTools MCP（https://github.com/example/devtools-mcp）')).toBe('Install the DevTools MCP')
  expect(cleanStepText('Read the docs (https://example.com/docs) first')).toBe('Read the docs first')
  expect(cleanStepText('Sandbox broken: `helper_unknown_error: setup had errors`')).toBe('Sandbox broken: helper_unknown_error: setup had errors')
  expect(cleanStepText('See https://example.com/a/b for details')).toBe('See for details')
  expect(parseTaskSteps('- [ ] Install `tool`（https://example.com/x）\n')).toEqual([{ title: 'Install tool', status: 'running' }])
})

test('wrapByWidth: breaks at a space when it can, so English words stay whole', () => {
  const lines = wrapByWidth('Supabase and Chrome DevTools', 12)
  expect(lines).toEqual(['Supabase and ', 'Chrome ', 'DevTools'])
  expect(lines.join('')).toBe('Supabase and Chrome DevTools')
  expect(wrapByWidth('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic']) // a word longer than the line still has to split
})

test('touchesChecklist: only writes to checklist.md / TASKS.md count, reads do not', () => {
  expect(touchesChecklist({ tool: 'Edit', file_path: 'C:\\work\\checklist.md' })).toBe(true)
  expect(touchesChecklist({ tool: 'Write', file_path: '/home/u/proj/TASKS.md' })).toBe(true)
  expect(touchesChecklist({ tool: 'Edit', file_path: 'C:\\work\\notes.md' })).toBe(false)
  expect(touchesChecklist({ tool: 'Read', file_path: 'C:\\work\\checklist.md' })).toBe(false)
  expect(touchesChecklist({ tool: 'Bash', command: "printf '- [ ] a' > checklist.md" })).toBe(true)
  expect(touchesChecklist({ tool: 'Bash', command: 'npm test' })).toBe(false)
})

test('nodeHeight: a timeline node grows with the number of text lines beside it', () => {
  expect([nodeHeight(1), nodeHeight(2), nodeHeight(3), nodeHeight(5)]).toEqual([48, 48, 72, 120])
})

test('isProjectSession: the project system\'s title, now or in previousTitles, marks a project session', () => {
  expect(isProjectSession({ title: 'Remote Control session (from a project)' })).toBe(true)
  expect(isProjectSession({ title: 'Backtest progress', previousTitles: ['Remote Control session (from a project)'] })).toBe(true)
  expect(isProjectSession({ title: 'Backtest progress', previousTitles: ['Old name'] })).toBe(false)
  expect(isProjectSession(null)).toBe(false)
})

test('projectTag: the first 2 characters of the folder name', () => {
  expect(projectTag('C:\\work\\Strategy room')).toBe('St')
  expect(projectTag('C:\\work\\策略討論區')).toBe('策略')
  expect(projectTag('/home/a/x')).toBe('x')
})

test('clientRowMode: regions while the first one may still start, for good once one reports it runs, plain rows after the grace otherwise', () => {
  const grace = 12000
  expect(clientRowMode({ supported: true, ready: false, firstDrawAt: null }, 0, grace)).toBe(true)
  expect(clientRowMode({ supported: true, ready: false, firstDrawAt: 1000 }, 12999, grace)).toBe(true)
  expect(clientRowMode({ supported: true, ready: false, firstDrawAt: 1000 }, 13000, grace)).toBe(false) // never started: fall back
  expect(clientRowMode({ supported: true, ready: true, firstDrawAt: 1000 }, 99999, grace)).toBe(true)
  expect(clientRowMode({ supported: false, ready: true, firstDrawAt: null }, 0, grace)).toBe(false)
  expect(clientRowMode({ supported: true, ready: true, failed: true, firstDrawAt: 1000 }, 2000, grace)).toBe(false) // stopped answering: plain rows
})
