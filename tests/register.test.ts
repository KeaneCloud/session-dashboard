// Integration tests: go through the hooks in register.js and check open order, the data layer, status lights, latest 5 steps, single-page layout, dividers
import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000
const MIN = 60_000
const CWD = 'C:\\work\\proj-a'
const APPDATA = 'C:\\Users\\u\\AppData\\Roaming'
const SESS_ROOT = APPDATA + '\\Claude\\claude-code-sessions'
const ORG_DIR = SESS_ROOT + '\\acc\\org'

const PANE = {
  plugin: 'session-dashboard', component: 'Pane', requestId: 'session-dashboard',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Sessions', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const BAND = {
  plugin: 'session-dashboard', component: 'AbovePrompt', requestId: 'above-prompt',
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 110, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const pane = (bodyRows: number, surface: 'desktop' | 'terminal' = 'desktop') => ({ ...PANE, surface, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } })

type Opts = {
  rateLimits?: unknown[]
  tasksMd?: string | null
  lang?: string // value of SESSION_DASHBOARD_LANG for the run (unset = English)
  checklistMd?: string | null
  desktopTitle?: string | null // null = no Desktop record (a terminal session)
  lastFocusedAt?: number
  extraRecords?: number // extra, newer records of other sessions in the Desktop records folder (no 30-record cap)
  ids?: string[] // values returned by session.id, in order (an id change after /clear)
  opens?: unknown[]
  runs?: string[][]
  toasts?: string[]
  writes?: string[] // the key of every store.set / delete
  onTool?: (e: any) => unknown // custom reply to tool calls (for the auto-naming tests)
  titleSource?: string // where the Desktop record's title came from ('user' = renamed by hand)
}

function stubEngine(on: any, saved: Map<string, unknown>, opts: Opts = {}) {
  const clock = mock.clock(on, { now: NOW })
  const ids = [...(opts.ids ?? ['me-1'])]
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => (opts.writes?.push('set ' + e.key), saved.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($: any, e: any) => (opts.writes?.push('del ' + e.key), saved.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'APPDATA' ? APPDATA : e.name === 'USERPROFILE' ? 'C:\\Users\\u' : e.name === 'SESSION_DASHBOARD_LANG' ? opts.lang : undefined }))
  on('fs.list', ($: any, e: any) => {
    if (e.path === SESS_ROOT && opts.desktopTitle !== null) return { value: [{ name: 'acc', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (e.path === SESS_ROOT + '\\acc') return { value: [{ name: 'org', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (e.path === ORG_DIR) {
      const extra = Array.from({ length: opts.extraRecords ?? 0 }, (_, i) => ({ name: 'local_x' + i + '.json', kind: 'file', size: 1, mtimeMs: 100 + i, isLink: false }))
      return { value: [...extra, { name: 'local_me-0001.json', kind: 'file', size: 1, mtimeMs: 9, isLink: false }] }
    }
    return { value: [] }
  })
  on('fs.read', ($: any, e: any) => {
    if (e.path.endsWith('local_me-0001.json')) return { value: JSON.stringify({ sessionId: 'local_me-0001', cliSessionId: ids[0], priorCliSessionIds: ['me-1'], title: opts.desktopTitle ?? 'MODS', titleSource: opts.titleSource ?? 'auto', lastFocusedAt: opts.lastFocusedAt ?? NOW - 60 * MIN }) }
    if (/local_x\d+\.json$/.test(e.path)) return { value: JSON.stringify({ sessionId: 'local_x', cliSessionId: 'someone-else' }) }
    if (opts.tasksMd != null && e.path.endsWith('TASKS.md')) return { value: opts.tasksMd }
    if (opts.checklistMd != null && e.path.endsWith('checklist.md')) return { value: opts.checklistMd }
    return { deny: 'ENOENT' }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: opts.lastFocusedAt ?? 1, isLink: false } }))
  on('fs.exists', () => ({ value: false }))
  on('session.id', () => ({ value: ids.length > 1 ? ids.shift() : ids[0] }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: opts.rateLimits ?? [] } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: 'mcp__session-dashboard__progress' } }))
  on('ui.open', ($: any, e: any) => (opts.opens?.push(e), { value: { isPlaced: true } }))
  on('ui.toast', ($: any, e: any) => (opts.toasts?.push(e.text), { value: undefined }))
  on('process.run', ($: any, e: any) => (opts.runs?.push(e.argv), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: 'x' }))
  on('session.attach', ($: any, e: any) => ({ clientId: e.clientId }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed ?? [] }))
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($: any, e: any) => (opts.onTool ? opts.onTool(e) : { result: 'engine' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['From another mod'] }))
  return clock
}

/** Start the session and let the after(0) background work finish */
async function start($: any, clock: any) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: CWD })
  await clock.advance(0)
  await clock.settle()
}
const complete = ($: any) => $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, usage: null, reason: 'answer' })
const other = (over: object = {}) => ({ id: 'other', name: 'Docs site', desktopId: 'local_other-0002', isWorking: false, lastSeen: NOW - 5000, firstSeen: 1, stats: { done: 0, total: 0, pct: 0, hasWarn: false, hasBad: false }, ...over })

/** Estimate the number of rows the rendered tree takes, following the pane's layout rules */
function estimateRows(n: any): number {
  if (!n || typeof n !== 'object') return 0
  const k = String(n.props?.key ?? '')
  if (k.startsWith('step-') || k.startsWith('proj-') || (k.startsWith('limit-') && !k.startsWith('limit-bar') && !k.startsWith('limit-compact'))) return 2
  if (k.startsWith('gap-')) return 1
  if (n.type === 'Text' || (n.type === 'Box' && n.props?.flexDirection === 'row') || k === 'section-divider') return 1
  const kids = (n.children ?? []).filter((c: any) => c && typeof c === 'object')
  return kids.reduce((sum: number, c: any) => sum + estimateRows(c), 0) + Math.max(0, kids.length - 1) * (n.props?.rowGap ?? 0)
}
const svgOf = async (ui: any, key: string) => ((await ui.find({ key })) as any)?.children?.[0]?.props.source as string | undefined

// ---------- Opening delay ----------

test('opening delay: session.start opens the pane first; the name lookup runs in the background (not inside session.start)', async ($, on) => {
  const saved = new Map<string, unknown>()
  const opens: unknown[] = []
  const writes: string[] = []
  const clock = stubEngine(on, saved, { opens, writes })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: CWD })
  expect(opens.length).toBe(1) // the pane is already open
  expect(writes).toEqual([]) // nothing published yet (including the name lookup)
  await clock.advance(0)
  await clock.settle()
  expect(saved.get('session:me-1')).toMatchObject({ name: 'MODS', desktopId: 'local_me-0001' })
})

test('without a Desktop record the name falls back to the folder name', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved, { desktopTitle: null })
  await start($, clock)
  expect(saved.get('session:me-1')).toMatchObject({ name: 'proj-a', desktopId: null })
})

test('more than 30 Desktop records with our own being older: the name is still found (no cap)', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved, { extraRecords: 40 })
  await start($, clock)
  expect(saved.get('session:me-1')).toMatchObject({ name: 'MODS', desktopId: 'local_me-0001' })
})

// ---------- /clear and session end ----------

test('/clear: data under the old id is deleted and the heartbeat does not write it back; classic.SessionStart registers the new id', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved, { ids: ['me-1', 'me-2'] })
  await start($, clock)
  expect(saved.has('session:me-1')).toBe(true)
  await $.session.end({ reason: 'clear' })
  expect(saved.has('session:me-1')).toBe(false)
  await clock.advance(31_000) // heartbeat
  expect(saved.has('session:me-1')).toBe(false) // no ghost entry written back under the old id
  await $.classic.SessionStart({ source: 'clear' })
  expect(saved.has('session:me-2')).toBe(true)
  expect(saved.get('session:me-2')).toMatchObject({ firstSeen: NOW + 31_000 })
})

test('real session end: data is deleted and timers are cancelled, so nothing is written as time passes', async ($, on) => {
  const saved = new Map<string, unknown>()
  const writes: string[] = []
  const clock = stubEngine(on, saved, { writes })
  await start($, clock)
  saved.set('progress:me-1', { steps: [{ title: 'A', status: 'running' }] })
  await $.session.end({ reason: 'prompt_input_exit' })
  expect([saved.has('session:me-1'), saved.has('progress:me-1')]).toEqual([false, false])
  saved.set('session:dead', other({ id: 'dead', lastSeen: NOW - 11 * MIN })) // a surviving timer would have the heartbeat cleanup delete this
  writes.length = 0
  await clock.advance(120_000)
  expect(writes).toEqual([])
})

// ---------- Rendering is read-only ----------

test('rendering the pane never writes to the store (expiring entries, clearing hides and saving usage happen elsewhere)', async ($, on) => {
  const saved = new Map<string, unknown>()
  const writes: string[] = []
  saved.set('session:dead', other({ id: 'dead', lastSeen: NOW - 11 * MIN }))
  saved.set('session:back', other({ id: 'back', lastFocusedAt: NOW - MIN }))
  saved.set('hidden:back', { at: NOW - 5 * MIN })
  const clock = stubEngine(on, saved, { writes, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] })
  await start($, clock)
  saved.set('session:dead', other({ id: 'dead', lastSeen: NOW - 11 * MIN })) // put back after the startup cleanup
  saved.set('hidden:back', { at: NOW - 5 * MIN })
  writes.length = 0
  const ui = await $.ui.mount(pane(30))
  await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(writes).toEqual([])
  expect(await ui.find({ key: 'jump-back' })).toBeDefined() // rendering still evaluates the "comes back automatically" rule
  await clock.advance(30_000) // the cleanup happens on the heartbeat
  expect([saved.has('session:dead'), saved.has('hidden:back')]).toEqual([false, false])
})

test('hides are stored one key each: two sessions hiding different projects keep both records', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:a', other({ id: 'a', name: 'A', desktopId: 'local_a-1', firstSeen: 1 }))
  saved.set('session:b', other({ id: 'b', name: 'B', desktopId: 'local_b-1', firstSeen: 2 }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  saved.set('hidden:b', { at: NOW }) // another session hides b at the same time
  await ui.press({ key: 'hide-a' })
  expect([saved.has('hidden:a'), saved.has('hidden:b')]).toEqual([true, true])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'unhide-all' })).toBeUndefined() // the "show hidden" button no longer exists
})

test('the legacy single-key hide record is still read and is migrated to per-session keys on the heartbeat', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:a', other({ id: 'a', desktopId: 'local_a-1' }))
  saved.set('hidden', { a: { at: NOW - MIN } })
  const clock = stubEngine(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: CWD })
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ key: 'jump-a' })).toBeUndefined()
  await clock.advance(0)
  await clock.settle()
  expect([saved.has('hidden'), saved.get('hidden:a')]).toEqual([false, { at: NOW - MIN }])
})

// ---------- Other sessions: lights, hide button, time, progress bar ----------

test('other sessions: ✕ comes first, light colors, only the time on the right, no status text', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:w', other({ id: 'w', name: 'Busy one', desktopId: 'local_w-1', firstSeen: 1, isWorking: true, hasToolSteps: true, eta: '~18m', stats: { done: 3, total: 4, pct: 75 } }))
  saved.set('session:u', other({ id: 'u', name: 'Unread one', desktopId: 'local_u-1', firstSeen: 2, finishedAt: NOW - 5 * MIN, lastFocusedAt: NOW - 30 * MIN }))
  saved.set('session:i', other({ id: 'i', name: 'Idle one', desktopId: 'local_i-1', firstSeen: 3, finishedAt: NOW - 125 * MIN, lastFocusedAt: NOW - MIN }))
  saved.set('session:x', other({ id: 'x', name: 'Broken one', desktopId: 'local_x-1', firstSeen: 4, stats: { done: 1, total: 4, pct: 25, hasWarn: true, hasBad: true } }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  // The light is the 2nd element on the left of the name line (a Text key cannot be used with find)
  const light = async (id: string) => ((await ui.find({ key: 'proj-' + id })) as any)?.children[0].children[0].children[0].children[1].props.color
  expect([await light('w'), await light('u'), await light('i')]).toEqual(['#0088b0', '#e07a10', '#77756f']) // blue working, orange finished-unread, gray hollow seen (there is no green light)
  const alert = await svgOf(ui, 'alert-x') // severe problem: red-outlined triangle with an exclamation mark, replacing the dot
  expect(alert).toContain('stroke="#c8222b"')
  expect(alert).toContain('<path')
  const line1 = ((await ui.find({ key: 'proj-w' })) as any).children[0].children[0]
  const left = line1.children[0].children
  expect([left[0].props.key, left[1].type, left[1].children[0], left[2].children[0].props.key]).toEqual(['hide-w', 'Text', '●', 'jump-w']) // ✕ → light → name
  const timeOf = async (id: string) => ((await ui.find({ key: 'jump-' + id + '-time' })) as any)?.props.label
  expect([await timeOf('w'), await timeOf('u'), await timeOf('i')]).toEqual(['75% · ~18m', '5m ago', '2h 5m ago']) // the percentage sits on the first line, right side, and is clickable
  expect(await ui.find({ type: 'Text', text: /Working ·|Idle ·|· background|In progress…|Done · unread|Current:/ })).toBeUndefined()
  expect(await svgOf(ui, 'line2-w')).toContain('width="210" height="4"') // the bar is stretched: 75% of 280px
  expect(await svgOf(ui, 'line2-u')).not.toContain('<rect') // no steps, no progress bar
})

test('idle time uses the work end time, not the heartbeat time (no permanent "just now")', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:o', other({ id: 'o', desktopId: 'local_o-1', lastSeen: NOW - 1000, finishedAt: NOW - 40 * MIN, lastFocusedAt: NOW }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(((await ui.find({ key: 'jump-o-time' })) as any)?.props.label).toBe('40m ago')
})

test('finished unread: finishing while another session is the one being viewed records the finish time as unseen', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:viewer', other({ id: 'viewer', lastFocusedAt: NOW - MIN })) // a different session was viewed most recently
  const clock = stubEngine(on, saved, { lastFocusedAt: NOW - 30 * MIN })
  await start($, clock)
  await $.turn.start({ turnId: 't' })
  await complete($)
  expect(saved.get('session:me-1')).toMatchObject({ finishedAt: NOW, seenAt: null })
})

test('finished unread: finishing while this session is open and viewed does not light up (seenAt = finish time)', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:viewer', other({ id: 'viewer', lastFocusedAt: NOW - 30 * MIN }))
  const clock = stubEngine(on, saved, { lastFocusedAt: NOW - MIN }) // this session was viewed most recently
  await start($, clock)
  await $.turn.start({ turnId: 't' })
  await complete($)
  expect(saved.get('session:me-1')).toMatchObject({ finishedAt: NOW, seenAt: NOW })
})

test('background still running: classic.Stop with background work is not a finish; it is recorded once the background is empty', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved)
  await start($, clock)
  await $.turn.start({ turnId: 't' })
  await $.classic.Stop({ background_tasks: [{ type: 'shell', description: 'Run benchmark' }] })
  await complete($)
  expect(saved.get('session:me-1')).toMatchObject({ finishedAt: null, background: { count: 1, current: 'Run benchmark' } })
  await $.classic.Stop({ background_tasks: [] })
  expect(saved.get('session:me-1')).toMatchObject({ background: null, finishedAt: NOW })
})

test('another session with background work shows a blue light and no status text on the right', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:o', other({ id: 'o', desktopId: 'local_o-1', background: { count: 1, current: 'Run benchmark' } }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(((await ui.find({ key: 'proj-o' })) as any)?.children[0].children[0].children[0].children[1].props.color).toBe('#0088b0')
  expect(await ui.find({ type: 'Text', text: /background|Run benchmark/i })).toBeUndefined()
})

test('pressing a name jumps to that session; without a Desktop id there is no button', async ($, on) => {
  const saved = new Map<string, unknown>()
  const runs: string[][] = []
  saved.set('session:o', other({ id: 'o', desktopId: 'local_o-0002' }))
  saved.set('session:t', other({ id: 't', name: 'Terminal', desktopId: null, firstSeen: 2 }))
  const clock = stubEngine(on, saved, { runs })
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ key: 'jump-t' })).toBeUndefined()
  await ui.press({ key: 'jump-o' })
  expect(runs).toEqual([['rundll32.exe', 'url.dll,FileProtocolHandler', 'claude://code/continue?session=local_o-0002']])
})

// ---------- Dividers ----------

test('dividers: Desktop draws a thick line with "Other sessions" embedded and a faint line in the blank row between sessions; the terminal uses ━', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:a', other({ id: 'a', desktopId: 'local_a-1', firstSeen: 1 }))
  saved.set('session:b', other({ id: 'b', desktopId: 'local_b-1', firstSeen: 2 }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(await svgOf(ui, 'section-divider')).toContain('>Other sessions</text>')
  expect(await ui.find({ type: 'Text', text: 'Other sessions' })).toBeUndefined() // no separate title row
  expect(await ui.find({ key: 'gap-b' })).toBeUndefined() // no blank row before the first one (b: more recently active, so first)
  expect(await svgOf(ui, 'gap-a')).toContain('fill="#ffffff18"') // 1 blank row between sessions, with the faint line inside it
  const term = await $.ui.mount(pane(30, 'terminal'))
  expect(await term.find({ type: 'Text', text: /^━+ Other sessions ━+$/ })).toBeDefined()
})

// ---------- Current session: latest 5 steps, notes ----------

test('current session: latest 5 steps, long notes wrap, done steps collapse, "N more" counts only unfinished steps', async ($, on) => {
  const saved = new Map<string, unknown>()
  const steps = [
    ...Array.from({ length: 34 }, (_, i) => ({ title: 'Done ' + i, status: 'done' })),
    { title: 'Live feed', status: 'warn', note: 'The snapshot API only covers two feeds and the old streaming endpoint was retired, so decide whether to contact support or switch to another source' },
    { title: 'Frontend metrics', status: 'todo' }, { title: 'Histogram', status: 'todo' }, { title: 'Write docs', status: 'todo' },
    ...Array.from({ length: 10 }, (_, i) => ({ title: 'Late done ' + i, status: 'done' })),
  ]
  saved.set('progress:me-1', { startedAt: NOW, updatedAt: NOW, steps })
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(40))
  expect(await ui.find({ type: 'Text', text: '42 done' })).toBeDefined() // a node on the timeline
  expect(await ui.find({ type: 'Text', text: '1 more' })).toBeDefined() // only "Write docs" is not shown
  for (const t of ['Done 32', 'Done 33', 'Live feed', 'Frontend metrics', 'Histogram']) expect(await ui.find({ type: 'Text', text: t })).toBeDefined()
  const note = (await ui.find({ type: 'Text', text: /^The snapshot API/ })) as any
  expect(note?.props.wrap).toBe('wrap') // long notes wrap instead of being truncated
})

test('no limit on other sessions: with many current steps including a severe one, all 6 other sessions are listed', async ($, on) => {
  const saved = new Map<string, unknown>()
  for (let i = 0; i < 6; i++) saved.set('session:o' + i, other({ id: 'o' + i, name: 'S' + i, desktopId: 'local_o' + i + '-1', firstSeen: i }))
  saved.set('progress:me-1', { startedAt: NOW, updatedAt: NOW, steps: [
    ...Array.from({ length: 20 }, (_, i) => ({ title: 'd' + i, status: 'done' })),
    { title: 'Broken', status: 'bad', note: 'type error' }, { title: 'Run', status: 'running' },
    ...Array.from({ length: 20 }, (_, i) => ({ title: 't' + i, status: 'todo' })),
  ] })
  const clock = stubEngine(on, saved, { rateLimits: [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 20 }] })
  await start($, clock)
  const ui = await $.ui.mount(pane(40))
  for (let i = 0; i < 6; i++) expect(await ui.find({ key: 'jump-o' + i })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /…\s*\d+ more/ })).toBeUndefined() // no "…N more" row for other sessions
  expect(await ui.find({ type: 'Text', text: 'Run' })).toBeDefined()
})

test('single page: at 24 and 30 rows nothing overflows, usage is always there, ✕ comes first', async ($, on) => {
  const saved = new Map<string, unknown>()
  for (let i = 0; i < 2; i++) saved.set('session:o' + i, other({ id: 'o' + i, name: 'A very very very very long other session name ' + i, desktopId: 'local_o' + i + '-1', firstSeen: i, isWorking: i % 2 === 0, hasToolSteps: true, eta: '~1h 15m', stats: { done: 1, total: 3, pct: 33, hasWarn: i === 1 } }))
  saved.set('progress:me-1', { startedAt: NOW, updatedAt: NOW, steps: [
    ...Array.from({ length: 5 }, (_, i) => ({ title: 'd' + i, status: 'done' })),
    { title: 'Warning', status: 'warn', note: 'A long note. '.repeat(10) }, { title: 'Run', status: 'running' },
    ...Array.from({ length: 5 }, (_, i) => ({ title: 't' + i, status: 'todo' })),
  ] })
  const clock = stubEngine(on, saved, { rateLimits: [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 20 }] })
  await start($, clock)
  await $.turn.start({ turnId: 't' })
  await $.classic.Stop({ background_tasks: [{ type: 'shell', description: 'Run benchmark' }] })
  for (const rows of [24, 30]) {
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount(pane(rows, surface))
      const root = (await ui.find({ type: 'Box' })) as any
      expect({ rows, surface, est: Math.min(estimateRows(root), rows), height: root.props.height }).toEqual({ rows, surface, est: estimateRows(root), height: rows })
      expect(await ui.find({ type: 'Text', text: 'Session limit' })).toBeDefined() // compact when the pane is short, but still there
      const firstProj = (await ui.find({ key: 'proj-o0' })) as any
      if (firstProj) expect(firstProj.children[0].children[0].children[0].children[0].props.key).toBe('hide-o0')
      await ui.unmount()
    }
  }
})

test('other sessions do not fit: all are listed and the height is not fixed (the pane scrolls); the current session keeps only its name + 1 row', async ($, on) => {
  const saved = new Map<string, unknown>()
  for (let i = 0; i < 8; i++) saved.set('session:o' + i, other({ id: 'o' + i, name: 'S' + i, desktopId: 'local_o' + i + '-1', firstSeen: i }))
  const clock = stubEngine(on, saved, { rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] })
  await start($, clock)
  const ui = await $.ui.mount(pane(12))
  for (let i = 0; i < 8; i++) expect(await ui.find({ key: 'jump-o' + i })).toBeDefined()
  const root = (await ui.find({ type: 'Box' })) as any
  expect(root.props.height).toBeUndefined()
  expect(await ui.find({ key: 'section-gap-0' })).toBeUndefined()
})

test('no report for over 60 seconds: the current session shows "Working · 1m" and never exposes paths or commands', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved)
  await start($, clock)
  await $.turn.start({ turnId: 't' })
  await $.tool.call({ tool: 'Bash', command: 'TOKEN=x npm test', description: 'Test C:\\work' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\proj-a\\hooks\\register.js', old_string: 'a', new_string: 'b' })
  await clock.advance(72_000)
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ type: 'Text', text: 'Working · 1m' })).toBeDefined() // without a task summary the label is "Working"
  expect(await ui.find({ type: 'Text', text: /Elapsed|Current:|register\.js|Run a command|Run:|Edit |TOKEN|npm|C:\\work/ })).toBeUndefined()
})

test('zh-TW: the pane and tool replies use Traditional Chinese when SESSION_DASHBOARD_LANG=zh-TW', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:a', other({ id: 'a', desktopId: 'local_a-1' })) // the divider only renders when another session exists
  const clock = stubEngine(on, saved, { lang: 'zh-TW' })
  await start($, clock)
  await $.turn.start({ turnId: 't' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\work\\proj-a\\hooks\\register.js', old_string: 'a', new_string: 'b' })
  await clock.advance(72_000)
  const ui = await $.ui.mount(pane(30))
  expect(await svgOf(ui, 'section-divider')).toContain('>其他 session</text>')
  expect(await svgOf(ui, 'section-divider')).not.toContain('Other sessions')
  expect(await ui.find({ type: 'Text', text: '工作中 · 1m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Working · 1m' })).toBeUndefined()
  const term = await $.ui.mount(pane(30, 'terminal'))
  expect(await term.find({ type: 'Text', text: /^━+ 其他 session ━+$/ })).toBeDefined()
  const out = await $.tool.call({ tool: 'mcp__session-dashboard__progress', steps: [{ title: 'A', status: 'done' }, { title: 'B', status: 'running' }] })
  expect(out).toEqual({ result: '已更新面板：1/2 完成' })
})

test('task summary: on submit a small model condenses the prompt to a short label; the pane shows one line "label · Nm"', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  // 13 words is over the limit, so the model is asked once more; the retry is no shorter, so the first complete label is kept
  const label = 'Simplify the current activity details shown on the pane for every running session'
  on('model.complete', ($: any, e: any) => (calls.push(e.prompt), { value: { isAnswered: true, text: '"' + label + '"', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('classic.UserPromptSubmit', () => ({}))
  const clock = stubEngine(on, saved)
  await start($, clock)
  await $.classic.UserPromptSubmit({ prompt: 'I think the pane shows too much detail' })
  await $.turn.start({ turnId: 't' })
  await clock.advance(0)
  await clock.settle()
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\a\\x.js', old_string: 'a', new_string: 'b' })
  await clock.advance(125_000)
  const ui = await $.ui.mount(pane(30))
  expect(calls[0]).toBe('I think the pane shows too much detail')
  expect(calls.length).toBe(2) // too long, so it asked once more
  expect(await ui.find({ type: 'Text', text: label + ' · 2m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /x\.js|Edit / })).toBeUndefined()
  await $.classic.Stop({ background_tasks: [{ type: 'shell', description: 'Run benchmark' }] })
  await complete($)
  await ui.unmount()
  const ui2 = await $.ui.mount(pane(30))
  expect(await ui2.find({ type: 'Text', text: label + ' · background' })).toBeDefined()
  expect(await ui2.find({ type: 'Text', text: /Run benchmark|Background command/ })).toBeUndefined()
})

// ---------- Usage ----------

test('usage: English reset time; session.measure stores the reading; a stale reading from another session is labelled "read N ago"', async ($, on) => {
  const saved = new Map<string, unknown>()
  const reset = (h: number) => new Date(NOW + h * 3600_000).toISOString()
  saved.set('usage:last', { at: NOW - 12 * MIN, rateLimits: [{ kind: 'five_hour', percentUsed: 64, resetsAt: reset(2) }, { kind: 'seven_day', percentUsed: 87, resetsAt: reset(-1) }] })
  const clock = stubEngine(on, saved, { rateLimits: [] })
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ type: 'Text', text: '64% · resets in 2h · read 12m ago' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Weekly limit' })).toBeUndefined() // readings past their reset time are dropped
  expect(await svgOf(ui, 'limit-bar-Session limit')).toContain('fill="#0088b0"')
  await $.session.measure({ context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 70 }], changed: ['rateLimits'] })
  expect(saved.get('usage:last')).toMatchObject({ at: NOW, rateLimits: [{ kind: 'five_hour', percentUsed: 70 }] })
})

test('our own live reading is not labelled with a reading time', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved, { rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] })
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ type: 'Text', text: '30%' })).toBeDefined()
})

// ---------- Other existing features ----------

test('progress tool: stores the steps, replies with one sentence, the summary carries the remaining time and current step', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved)
  await start($, clock)
  const out = await $.tool.call({ tool: 'mcp__session-dashboard__progress', steps: [{ title: 'A', status: 'done' }, { title: 'B', status: 'running' }] })
  expect(out).toEqual({ result: 'Pane updated: 1/2 done' })
  expect(saved.get('session:me-1')).toMatchObject({ stepLabel: 'B', eta: '~1m' })
})

test('above the prompt: ☰ Sessions keeps content from other mods and opens the pane when pressed', async ($, on) => {
  const saved = new Map<string, unknown>()
  const opens: unknown[] = []
  const clock = stubEngine(on, saved, { opens })
  await start($, clock)
  opens.length = 0
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'From another mod' })).toBeDefined()
  await ui.press({ key: 'open-sessions' })
  expect(opens).toEqual([{ id: 'session-dashboard', title: 'Sessions', focus: true }])
})

test('the pane reopens automatically when a Desktop client attaches', async ($, on) => {
  const saved = new Map<string, unknown>()
  const opens: unknown[] = []
  stubEngine(on, saved, { opens })
  await $.session.attach({ surface: 'desktop', clientId: 'c1' })
  expect(opens).toEqual([{ id: 'session-dashboard', title: 'Sessions' }])
})

test('untrack: hidden after ✕; a session comes back only once it has been opened afterwards, not when it starts a new turn by itself', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:opened', other({ id: 'opened', desktopId: 'local_opened-1', lastFocusedAt: NOW - MIN }))
  saved.set('session:worked', other({ id: 'worked', desktopId: 'local_worked-1', firstSeen: 2, workStartedAt: NOW - MIN, isWorking: true, lastFocusedAt: NOW - 9 * MIN }))
  saved.set('session:shown', other({ id: 'shown', desktopId: 'local_shown-1', firstSeen: 3 }))
  saved.set('hidden:opened', { at: NOW - 5 * MIN })
  saved.set('hidden:worked', { at: NOW - 5 * MIN })
  const clock = stubEngine(on, saved)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: CWD })
  const ui = await $.ui.mount(pane(30))
  expect([!!(await ui.find({ key: 'jump-opened' })), !!(await ui.find({ key: 'jump-worked' }))]).toEqual([true, false])
  expect(((await ui.find({ key: 'hide-shown' })) as any).props.label).toBe('✕')
  void clock
})

test('long text wraps: task, step titles and notes all use wrap; a long other-session name splits into several lines, each clickable', async ($, on) => {
  const saved = new Map<string, unknown>()
  // CJK name on purpose: full-width characters take 2 cells each when wrapping
  const long = '文件網站重新設計與 Dashboard 面板間距的參數調整與報表輸出'
  saved.set('session:o1', other({ id: 'o1', name: long, desktopId: 'local_o1-1' }))
  saved.set('progress:me-1', { startedAt: NOW, updatedAt: NOW, task: 'A very long task name '.repeat(6), steps: [{ title: 'A very long step title '.repeat(6), status: 'running' }] })
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount({ ...pane(40), props: { ...pane(40).props, bodyColumns: 40 } })
  const texts = (await ui.findAll({ type: 'Text' })) as any[]
  expect(texts.filter((t) => t.props.wrap === 'truncate-end' && !/^$|ago$|^~|%/.test(String(t.children[0] ?? ''))).map((t) => t.children[0])).toEqual([])
  const parts = ((await ui.findAll({ type: 'Button' })) as any[]).filter((b) => String(b.props.key).startsWith('jump-o1'))
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.map((b) => b.props.label).join('')).toBe(long)
})

// ---------- Spacing, continuous timeline, auto-naming ----------

test('3 blank rows between the current session and "Other sessions"; the blank rows shrink first when space is tight', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:a', other({ id: 'a', desktopId: 'local_a-1' }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const big = await $.ui.mount(pane(30))
  const content = (await big.find({ key: 'content' })) as any
  const kinds = content.children.map((c: any) => c.type + ':' + (c.props?.key ?? c.children?.[0] ?? ''))
  const at = kinds.findIndex((k: string) => k === 'Box:section-divider')
  expect(kinds.slice(at - 3, at)).toEqual(['Text: ', 'Text: ', 'Text: '])
  await big.unmount()
  const tiny = await $.ui.mount(pane(9))
  const root = (await tiny.find({ type: 'Box' })) as any
  expect(estimateRows(root) <= 9).toBe(true)
  expect(await tiny.find({ key: 'jump-a' })).toBeDefined() // the other session is not pushed out by the blank rows
})

test('the timeline is one continuous line: every node has the same height, "N done" / "N more" are nodes too, no line at either end', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('progress:me-1', { startedAt: NOW, updatedAt: NOW, steps: [
    ...Array.from({ length: 6 }, (_, i) => ({ title: 'd' + i, status: 'done' })),
    { title: 'Run', status: 'running' }, ...Array.from({ length: 6 }, (_, i) => ({ title: 't' + i, status: 'todo' })),
  ] })
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(40))
  const nodes: string[] = []
  for (let i = 0; i < 7; i++) nodes.push((await svgOf(ui, 'node-' + i)) ?? '')
  expect(nodes.every((n) => n.includes('height="48"'))).toBe(true)
  expect(nodes[0]).not.toContain('y="0"') // the first node ("4 done") has no upper line
  expect(nodes[6]).toContain('stroke-dasharray') // the last node is "N more"
  expect(nodes[6].match(/<rect /g)?.length).toBe(1) // no lower line
  for (const n of nodes.slice(1, 6)) expect(n.match(/<rect /g)?.length).toBe(2) // middle nodes have both lines
  expect(await ui.find({ type: 'Text', text: '4 done' })).toBeDefined()
  const term = await $.ui.mount(pane(40, 'terminal'))
  expect(await term.find({ type: 'Text', text: '│' })).toBeDefined()
})

/** Stubs for auto-naming: turn count, conversation messages, the small model, the rename tool */
function stubRename(on: any, opts: { turns: number; reply?: string; replies?: string[]; messages?: any[]; prompts?: string[]; systems?: string[]; toolFails?: boolean; calls: any[] }): Opts {
  on('session.turns', () => ({ value: opts.turns }))
  on('session.messages', () => ({ value: opts.messages ?? [{ role: 'user', text: 'Adjust the pane spacing', toolUses: [] }, { role: 'assistant', text: 'OK', toolUses: [] }] }))
  on('model.complete', ($: any, e: any) => (opts.calls.push(['model', e.model]), opts.prompts?.push(e.prompt), opts.systems?.push(e.system), { value: { isAnswered: true, text: opts.replies?.shift() ?? opts.reply ?? '"Pane spacing and timeline"', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('ui.log', () => ({ value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
  return {
    onTool: (e: any) => {
      if (e.tool === 'mcp__ccd_session_mgmt__set_session_title') {
        opts.calls.push(['rename', e.session_id, e.title])
        if (opts.toolFails) return { deny: 'no such tool' }
      }
      return { result: 'ok' }
    },
  }
}

test('auto-naming: after turn 2 a small model picks a short name and the Desktop rename tool is called, exactly once', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const clock = stubEngine(on, saved, stubRename(on, { turns: 2, calls }))
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls).toEqual([['model', 'haiku'], ['rename', 'self', 'Pane spacing and timeline']])
  expect(saved.get('session:me-1')).toMatchObject({ name: 'Pane spacing and timeline' })
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls.length).toBe(2) // not renamed a second time
})

test('auto-naming: nothing happens before turn 2', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const clock = stubEngine(on, saved, stubRename(on, { turns: 1, calls }))
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls).toEqual([])
})

test('auto-naming: when the rename tool fails, the next submitted prompt carries sessionTitle', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const clock = stubEngine(on, saved, stubRename(on, { turns: 4, toolFails: true, calls }))
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  const r1 = await $.classic.UserPromptSubmit({ prompt: 'Next message' })
  const r2 = await $.classic.UserPromptSubmit({ prompt: 'One more message' })
  expect([r1?.sessionTitle, r2?.sessionTitle]).toEqual(['Pane spacing and timeline', undefined])
})

test('auto-naming: a session renamed by hand (titleSource = user) is left alone', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const clock = stubEngine(on, saved, { ...stubRename(on, { turns: 5, calls }), titleSource: 'user' })
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls).toEqual([])
})

test('auto-naming: a session started by the project system keeps the project name, and the pane shows that name', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const clock = stubEngine(on, saved, { ...stubRename(on, { turns: 5, calls }), desktopTitle: 'Remote Control session (from a project)', titleSource: 'auto' })
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls).toEqual([])
  expect((saved.get('session:me-1') as any)?.name).toBe('Remote Control session (from a project)')
})

test('auto-naming: the rule asks for the noun only (no verbs, no adjectives), at most 6 units, and lists the other sessions\' names', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:other', other({ name: 'Admin site' }))
  const calls: any[] = []
  const systems: string[] = []
  const clock = stubEngine(on, saved, stubRename(on, { turns: 3, calls, systems, reply: 'Pane spacing' }))
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(systems[0]).toContain('no verbs and no adjectives')
  expect(systems[0]).toContain('Admin site')
  expect(systems[0]).toContain('-<purpose>')
  expect(systems[0]).toContain('At most 9 words') // 6 + a 3-unit "-purpose" suffix when other sessions exist
})

test('auto-naming: a name already used by another session is asked once more for a "-purpose" suffix', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:other', other({ name: 'Admin site' }))
  const calls: any[] = []
  const clock = stubEngine(on, saved, stubRename(on, { turns: 3, calls, replies: ['Admin site', 'Admin site-login'] }))
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls).toEqual([['model', 'haiku'], ['model', 'haiku'], ['rename', 'self', 'Admin site-login']])
})

test('auto-naming: with no other sessions the limit is 6 units', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const systems: string[] = []
  const clock = stubEngine(on, saved, stubRename(on, { turns: 3, calls, systems, reply: 'Pane spacing' }))
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(systems[0]).toContain('At most 6 words')
  expect(systems[0]).not.toContain('Other sessions are named')
})

test('whole row: one hover scope with a background, the name lines and the time all jump to the session', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:o', other({ id: 'o', name: 'A rather long session name that wraps onto a second line here', desktopId: 'local_o-1', finishedAt: NOW - 5 * MIN }))
  const runs: any[] = []
  const clock = stubEngine(on, saved, { runs })
  await start($, clock)
  const ui = await $.ui.mount({ ...pane(30), props: { ...pane(30).props, bodyColumns: 30 } })
  const row = (await ui.find({ key: 'proj-o' })) as any
  expect(row.children[0].hover?.backgroundColor).toBeTruthy() // the Box filling the row lights while the pointer is anywhere on it
  const presses = ['jump-o', 'jump-o-1', 'jump-o-time']
  for (const key of presses) await ui.press({ key })
  expect(runs.length).toBe(3)
  expect(runs.every((r) => String(r[2]).endsWith('session=local_o-1'))).toBe(true)
})

test('hover line: hidden until the pointer is on the row; says what needs the user, what is being done, or what was done', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:x', other({ id: 'x', desktopId: 'local_x-1', stats: { done: 0, total: 2, pct: 0, hasWarn: true, hasBad: false }, alertNote: 'Pick a test period', stepLabel: 'Backtest' }))
  saved.set('session:w', other({ id: 'w', desktopId: 'local_w-1', isWorking: true, stepLabel: 'Filter rules' }))
  saved.set('session:d', other({ id: 'd', desktopId: 'local_d-1', finishedAt: NOW - MIN, lastFocusedAt: NOW, lastDoneLabel: 'Ranking page' }))
  saved.set('session:n', other({ id: 'n', desktopId: 'local_n-1' }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(40))
  // The hover line is the last child of the row Box (it has no key of its own: a keyed Box would be its own hover scope)
  const line = async (id: string) => { const row = ((await ui.find({ key: 'proj-' + id })) as any).children[0]; const last = row.children[row.children.length - 1]; return last?.props?.display === 'none' ? last : undefined }
  for (const id of ['x', 'w', 'd']) {
    expect((await line(id)).props.display).toBe('none')
    expect((await line(id)).hover ?? (await line(id)).props.hover).toEqual({ display: 'flex' })
  }
  expect((await line('x')).children[0].children[0]).toBe('Needs you: Pick a test period')
  expect((await line('w')).children[0].children[0]).toBe('Doing: Filter rules')
  expect((await line('d')).children[0].children[0]).toBe('Done: Ranking page')
  expect(await line('n')).toBeUndefined() // nothing to say, no line
})

test('order: needs-you first, then finished-unseen, then working, then seen; most recently active first within a level', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:i', other({ id: 'i', name: 'Seen', desktopId: 'local_i-1', firstSeen: 1, finishedAt: NOW - 10 * MIN, lastFocusedAt: NOW }))
  saved.set('session:w', other({ id: 'w', name: 'Working', desktopId: 'local_w-1', firstSeen: 2, isWorking: true, workStartedAt: NOW - MIN }))
  saved.set('session:u1', other({ id: 'u1', name: 'Unread old', desktopId: 'local_u1-1', firstSeen: 3, finishedAt: NOW - 30 * MIN, lastFocusedAt: NOW - 60 * MIN }))
  saved.set('session:u2', other({ id: 'u2', name: 'Unread new', desktopId: 'local_u2-1', firstSeen: 4, finishedAt: NOW - 2 * MIN, lastFocusedAt: NOW - 60 * MIN }))
  saved.set('session:x', other({ id: 'x', name: 'Needs you', desktopId: 'local_x-1', firstSeen: 5, stats: { done: 0, total: 1, pct: 0, hasWarn: true, hasBad: false } }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(60))
  const order: string[] = []
  const walk = (n: any) => { if (!n || typeof n !== 'object') return; if (typeof n.props?.key === 'string' && n.props.key.startsWith('proj-')) order.push(n.props.key.slice(5)); (n.children ?? []).forEach(walk) }
  walk(await ui.find({ key: 'content' }))
  expect(order).toEqual(['x', 'u2', 'u1', 'w', 'i'])
})

test('groups: sessions sharing the name before "-" sit together under a header with the count; a lone name is not grouped; needs-you stays on top', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:a', other({ id: 'a', name: 'Admin site', desktopId: 'local_a-1', firstSeen: 1, finishedAt: NOW - 50 * MIN, lastFocusedAt: NOW }))
  saved.set('session:b', other({ id: 'b', name: 'Docs', desktopId: 'local_b-1', firstSeen: 2, finishedAt: NOW - 40 * MIN, lastFocusedAt: NOW }))
  saved.set('session:c', other({ id: 'c', name: 'Admin site-login', desktopId: 'local_c-1', firstSeen: 3, finishedAt: NOW - 5 * MIN, lastFocusedAt: NOW }))
  saved.set('session:x', other({ id: 'x', name: 'Admin site-billing', desktopId: 'local_x-1', firstSeen: 4, stats: { done: 0, total: 1, pct: 0, hasWarn: true, hasBad: false } }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(60))
  const seq: string[] = []
  const walk = (n: any) => { if (!n || typeof n !== 'object') return; const k = n.props?.key; if (typeof k === 'string' && (k.startsWith('proj-') || k.startsWith('group-'))) seq.push(k); (n.children ?? []).forEach(walk) }
  walk(await ui.find({ key: 'content' }))
  expect(seq).toEqual(['proj-x', 'group-Admin site', 'proj-c', 'proj-a', 'proj-b'])
  expect(await ui.find({ type: 'Text', text: '▾ Admin site (2)' })).toBeDefined()
  expect(await ui.find({ key: 'group-Docs' })).toBeUndefined()
})

test('one Desktop session whose CLI id changed is listed once, keeping the entry with the latest heartbeat', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:old', other({ id: 'old', name: 'Billing export', desktopId: 'local_dup-1', lastSeen: NOW - 400_000, firstSeen: 1, finishedAt: NOW - 400_000 }))
  saved.set('session:new', other({ id: 'new', name: 'Billing export', desktopId: 'local_dup-1', lastSeen: NOW - 4000, firstSeen: 2, isWorking: true }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ key: 'jump-new' })).toBeDefined()
  expect(await ui.find({ key: 'jump-old' })).toBeUndefined()
})

test('auto-naming: an over-long name is not truncated; the model is asked once for a shorter complete name; an English word counts as 1 unit', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  // CJK replies on purpose: each CJK character counts as 1 unit (2 words + 10 characters = 12, over the limit of 10)
  const opts = stubRename(on, { turns: 3, calls, replies: ['「Session dashboard 面板間距調整與時間軸」', 'Session dashboard 間距調整'] })
  const clock = stubEngine(on, saved, opts)
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls).toEqual([['model', 'haiku'], ['model', 'haiku'], ['rename', 'self', 'Session dashboard 間距調整']])
})

test('auto-naming: if the retry is still too long, the shorter complete name is used, never one cut in half', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  // CJK replies on purpose: 15 and 13 characters, both over the limit of 10
  const opts = stubRename(on, { turns: 3, calls, replies: ['文件網站重新設計與部署流程規劃', '文件網站重新設計與部署規劃'] })
  const clock = stubEngine(on, saved, opts)
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  expect(calls.at(-1)).toEqual(['rename', 'self', '文件網站重新設計與部署規劃'])
})

test('auto-naming: uses the whole session, not just the last turn (the first request and the ones in between are all included)', async ($, on) => {
  const saved = new Map<string, unknown>()
  const calls: any[] = []
  const prompts: string[] = []
  const messages = [
    { role: 'user', text: 'Build the billing export report', toolUses: [] },
    { role: 'assistant', text: 'OK, fetching the data first', toolUses: [] },
    ...Array.from({ length: 40 }, (_, i) => ({ role: 'assistant', text: 'Tool result ' + i + ' ' + 'x'.repeat(300), toolUses: [{}] })),
    { role: 'user', text: 'Add a retry limit', toolUses: [] },
    ...Array.from({ length: 40 }, (_, i) => ({ role: 'assistant', text: 'More output ' + i + ' ' + 'y'.repeat(300), toolUses: [{}] })),
    { role: 'user', text: 'Finally fix the chart colors', toolUses: [] },
    { role: 'assistant', text: 'Done', toolUses: [] },
  ]
  const opts = stubRename(on, { turns: 3, calls, messages, prompts })
  const clock = stubEngine(on, saved, opts)
  await start($, clock)
  await complete($)
  await clock.advance(0)
  await clock.settle()
  for (const t of ['Build the billing export report', 'Add a retry limit', 'Finally fix the chart colors']) expect(prompts[0]).toContain(t)
  expect(prompts[0].length).toBeLessThanOrEqual(6000)
})

test('the pane reads checklist.md (preferred when present, TASKS.md otherwise)', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved, { tasksMd: '- [ ] Old TASKS item\n', checklistMd: '- [x] Back up\n- [ ] Update checklist rules\n- [ ] Write tests\n' })
  await start($, clock)
  await $.tool.call({ tool: 'Edit', file_path: CWD + '\\checklist.md', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount(pane(30))
  expect(await ui.find({ type: 'Text', text: 'Update checklist rules' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Old TASKS item' })).toBeUndefined()
})

test('fewer redraws: none when other sessions are unchanged; within 10 s of a change; not right away on a usage change; once a minute for times', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:o1', other({ id: 'o1', lastSeen: NOW, finishedAt: NOW - 60_000 }))
  let redraws = 0
  on('ui.invalidate', () => (redraws++, { value: undefined }))
  const clock = stubEngine(on, saved)
  await start($, clock)
  await clock.advance(1_000)
  redraws = 0
  await clock.advance(25_000) // the heartbeat updates lastSeen, but the visible state is unchanged
  expect(redraws).toBe(0)
  await $.session.measure({ context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 70 }], changed: ['rateLimits'] })
  expect(redraws).toBe(0)
  saved.set('session:o1', other({ id: 'o1', lastSeen: NOW + 26_000, isWorking: true }))
  await clock.advance(10_000)
  expect(redraws).toBe(1)
  await clock.advance(25_000) // second 61: the once-a-minute redraw
  expect(redraws).toBe(2)
})

test('a checklist in the working folder is ignored until this session writes to it', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = stubEngine(on, saved, { checklistMd: '- [ ] Someone else\'s to-do\n- [ ] Another item\n' })
  await start($, clock)
  const before = await $.ui.mount(pane(30))
  expect(await before.find({ type: 'Text', text: "Someone else's to-do" })).toBeUndefined()
  expect(await before.find({ type: 'Text', text: 'No steps in progress' })).toBeDefined()
  expect((saved.get('session:me-1') as any).stats.total).toBe(0)
  await before.unmount()
  await $.tool.call({ tool: 'Write', file_path: CWD + '\\checklist.md', content: 'x' })
  const after = await $.ui.mount(pane(30))
  expect(await after.find({ type: 'Text', text: "Someone else's to-do" })).toBeDefined()
})

test('a step that wraps onto several lines gets a taller timeline node; the time on the right never wraps', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:o1', other({ id: 'o1', name: 'Docs site', desktopId: 'local_o1-1', finishedAt: NOW - 3 * 60 * MIN, stats: { done: 0, total: 2, pct: 0, hasWarn: false, hasBad: false } }))
  saved.set('progress:me-1', { startedAt: NOW, updatedAt: NOW, steps: [
    { title: 'A very long step title that will need several lines in a narrow pane to be shown in full', status: 'running' },
    { title: 'Short', status: 'todo' },
  ] })
  const clock = stubEngine(on, saved)
  await start($, clock)
  const ui = await $.ui.mount({ ...pane(40), props: { ...pane(40).props, bodyColumns: 40 } })
  const heightOf = (svg?: string) => Number(svg?.match(/height="(\d+)"/)?.[1])
  expect(heightOf(await svgOf(ui, 'node-0'))).toBeGreaterThan(48)
  expect(heightOf(await svgOf(ui, 'node-1'))).toBe(48)
  const right = ((await ui.find({ key: 'proj-o1' })) as any).children[0].children[0].children[1]
  expect(right.props.flexShrink).toBe(0)
  expect(right.children[0].props.key).toBe('jump-o1-time') // a button: its label never wraps
})
