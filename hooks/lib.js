// Pure logic for session-dashboard: never touches $, so it can be unit-tested directly.
import { t } from './i18n.js'

// ===== Tunables (edit here) =====
export const STALE_MS = 10 * 60 * 1000   // A session with no heartbeat for this long is treated as closed (crashed sessions get cleaned up too)
export const BAR_WIDTH = 10              // Number of cells in the progress bar
export const WARN_PCT = 50               // Usage >= this value is shown in yellow
export const DANGER_PCT = 80             // Usage >= this value is shown in red

// The kind names in $.session.usage().rateLimits (see SessionRateLimit in .claude-plugin/types/claude-code/index.d.ts)
const WINDOW_LABELS = { five_hour: 'Session limit', seven_day: 'Weekly limit' }

// TASKS.md checkbox lines: - [ ] / - [x] / * [X], indentation allowed
const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/

/** Percentage → "▓▓▓░░░" progress bar; values outside 0–100 are clamped. */
export function bar(pct, width = BAR_WIDTH) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0))
  const filled = Math.round((clamped / 100) * width)
  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

/** Color for a usage percentage; undefined means the default color. */
export function pctColor(pct) {
  if (pct >= DANGER_PCT) return 'red'
  if (pct >= WARN_PCT) return 'yellow'
  return undefined
}

const pad2 = (n) => String(n).padStart(2, '0')

/** Reset time (legacy format, kept for compatibility): HH:MM on the same day, otherwise M/D HH:MM. */
export function formatReset(iso, nowMs) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const hm = pad2(t.getHours()) + ':' + pad2(t.getMinutes())
  const now = new Date(nowMs)
  const sameDay = t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate()
  return sameDay ? hm : (t.getMonth() + 1) + '/' + t.getDate() + ' ' + hm
}

/**
 * rateLimits → segments of the usage row, in the order 5h, weekly.
 * Returns [{ label, pct, text, color }]; an empty array when there are no readings.
 */
export function usageSegments(rateLimits, nowMs) {
  const list = Array.isArray(rateLimits) ? rateLimits : []
  const segments = []
  for (const kind of Object.keys(WINDOW_LABELS)) {
    const w = list.find((r) => r && r.kind === kind)
    if (!w || typeof w.percentUsed !== 'number') continue
    const pct = w.percentUsed
    const reset = relativeReset(w.resetsAt, nowMs)
    const label = WINDOW_LABELS[kind]
    segments.push({
      label,
      pct,
      reset,
      color: pctColor(pct),
      text: label + ' ' + bar(pct) + ' ' + pct + '%' + (reset ? ' · ' + reset : ''),
    })
  }
  return segments
}

/** The last path segment is the project name (handles both / and \). */
/** Tag that marks which project a project-system session belongs to: the first `chars` characters of its folder name. */
/**
 * Whether other sessions are drawn as Client regions: yes once one has reported it runs; yes while the first one is still within `graceMs` of being drawn;
 * no after that (the desktop app's region runtime never started, so plain rows are drawn instead), and no when the surface has no Client at all.
 */
export function clientRowMode(probe, now, graceMs) {
  if (!probe.supported) return false
  if (probe.ready) return true
  return probe.firstDrawAt === null || now - probe.firstDrawAt < graceMs
}

export function projectTag(cwd, chars = 2) {
  return [...folderName(cwd)].slice(0, chars).join('')
}

export function folderName(cwd) {
  const parts = String(cwd ?? '').split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : String(cwd ?? '')
}

/** Builds the checklist file path from the working folder (default TASKS.md), keeping cwd's original separator. */
export function tasksPath(cwd, name = 'TASKS.md') {
  const sep = String(cwd).includes('\\') ? '\\' : '/'
  return String(cwd).replace(/[\\/]+$/, '') + sep + name
}

// Step checklist files, searched in order (edit here): the global CLAUDE.md specifies checklist.md, older projects still use TASKS.md
export const CHECKLIST_FILES = ['checklist.md', 'TASKS.md']

/** Fingerprint deciding whether the panel needs a redraw: only visible state (status light, name, progress); constantly changing values such as the heartbeat time are excluded. */
export function othersSignature(entries, hiddenKeys = []) {
  const shown = (entries ?? []).map((s) => [s.id, s.name, statusOf(s), s.stats?.pct ?? null, s.stats?.total ?? 0, s.eta ?? null, s.stepLabel ?? null])
  return JSON.stringify([shown, [...hiddenKeys].sort()])
}

/**
 * Keeps the sessions that are still alive, sorted by "first seen" time (earliest on top); the order never changes with heartbeats or work status afterwards, to avoid misclicks.
 * Summaries from older versions without firstSeen go last, then ordered by id for stability.
 */
export function liveSessions(entries, nowMs, staleMs = STALE_MS) {
  const first = (s) => (typeof s.firstSeen === 'number' ? s.firstSeen : Number.MAX_SAFE_INTEGER)
  // When one Desktop session has changed its CLI session id (priorCliSessionIds), the old entry lingers until it expires; keep only the one with the most recent heartbeat, and use the earlier firstSeen so its position doesn't jump
  const byDesktop = new Map()
  const rest = []
  for (const s of entries) {
    if (!s || typeof s.lastSeen !== 'number' || nowMs - s.lastSeen > staleMs) continue
    if (!s.desktopId) { rest.push(s); continue }
    const prev = byDesktop.get(s.desktopId)
    if (!prev) { byDesktop.set(s.desktopId, s); continue }
    const [keep, drop] = s.lastSeen >= prev.lastSeen ? [s, prev] : [prev, s]
    byDesktop.set(s.desktopId, { ...keep, firstSeen: Math.min(first(keep), first(drop)) })
  }
  return [...rest, ...byDesktop.values()]
    .sort((a, b) => (first(a) - first(b)) || String(a.id).localeCompare(String(b.id)))
}

// ===== Step progress =====

export const STEP_STATUSES = ['done', 'running', 'warn', 'bad', 'todo']

/** Step identity: title + occurrence number among same-titled steps (each same-titled step keeps its own timing). */
function stepKeys(steps) {
  const seen = new Map()
  return steps.map((s) => {
    const n = (seen.get(s.title) ?? 0) + 1
    seen.set(s.title, n)
    return s.title + '#' + n
  })
}

/**
 * Merges the step list sent by the progress tool with the previous record to derive timing info.
 * Every call sends the full list (idempotent); steps are matched by "title + occurrence number", recording when a step was first seen as non-todo and when it became done.
 * Returns { task, startedAt, updatedAt, steps: [{ title, status, note, startedAt, doneAt }] }
 */
export function mergeProgress(prev, input, nowMs) {
  const prevSteps = prev?.steps ?? []
  const old = new Map(stepKeys(prevSteps).map((k, i) => [k, prevSteps[i]]))
  const raw = (Array.isArray(input?.steps) ? input.steps : [])
    .filter((s) => s && typeof s.title === 'string' && s.title.trim() !== '')
    .map((s) => ({ ...s, title: s.title.trim() }))
  const keys = stepKeys(raw)
  const steps = raw.map((s, i) => {
    const status = STEP_STATUSES.includes(s.status) ? s.status : 'todo'
    const was = old.get(keys[i])
    const startedAt = was?.startedAt ?? (status !== 'todo' ? nowMs : undefined)
    const doneAt = status === 'done' ? (was?.doneAt ?? nowMs) : undefined
    const note = typeof s.note === 'string' && s.note.trim() !== '' ? s.note.trim() : undefined
    return { title: s.title, status, note, startedAt, doneAt }
  })
  // A whole new batch of tasks (none of the old steps remain) restarts the timer
  const sameTask = keys.some((k) => old.has(k))
  return {
    task: typeof input?.task === 'string' && input.task.trim() !== '' ? input.task.trim() : (sameTask ? prev?.task : undefined),
    startedAt: sameTask && prev?.startedAt ? prev.startedAt : nowMs,
    updatedAt: nowMs,
    steps,
  }
}

/**
 * TASKS.md → step list (fallback when Claude didn't call the progress tool).
 * [x] = done; a [ ] containing BLOCKED = warn (the text after BLOCKED becomes the note); the first other [ ] = running; the rest are todo.
 */
/** Tidy a checklist item for display: drop URLs (with the brackets around them) and Markdown backticks. */
// Desktop's beta project system names the sessions it starts "Remote Control session (from a project)" (seen in the session records, 2026-10-19)
const PROJECT_TITLE_MARK = '(from a project)'

/** Whether a Desktop session record belongs to a session started by the project system (its first title carries PROJECT_TITLE_MARK). */
export function isProjectSession(record) {
  const titles = [record?.title, ...(Array.isArray(record?.previousTitles) ? record.previousTitles : [])]
  return titles.some((title) => typeof title === 'string' && title.includes(PROJECT_TITLE_MARK))
}

export function cleanStepText(text) {
  return String(text ?? '')
    .replace(/[（(]\s*https?:\/\/[^\s）)]*\s*[）)]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a tool call writes one of the checklist files (CHECKLIST_FILES); reading one does not count. */
export function touchesChecklist(e) {
  const tool = String(e?.tool ?? '')
  const isChecklist = (s) => CHECKLIST_FILES.some((name) => String(s ?? '').toLowerCase().includes(name.toLowerCase()))
  if (['Edit', 'Write', 'MultiEdit'].includes(tool)) return isChecklist(String(e.file_path ?? '').split(/[\\/]/).pop())
  if (tool === 'Bash' || tool === 'PowerShell') return isChecklist(e.command)
  return false
}

export function parseTaskSteps(md) {
  const steps = []
  let runningAssigned = false
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const m = line.match(TASK_LINE)
    if (!m) continue
    const text = cleanStepText(m[2])
    if (m[1] !== ' ') {
      steps.push({ title: text, status: 'done' })
      continue
    }
    // CRITICAL (or its Chinese equivalent in the regex) = bad (red), BLOCKED = warn (orange)
    const blocked = text.match(/^(.*?)\s*(BLOCKED|CRITICAL|嚴重)[:：]?\s*(.*)$/)
    if (blocked) {
      steps.push({ title: blocked[1].trim() || text, status: blocked[2] === 'BLOCKED' ? 'warn' : 'bad', note: blocked[3].trim() || undefined })
    } else if (!runningAssigned) {
      steps.push({ title: text, status: 'running' })
      runningAssigned = true
    } else {
      steps.push({ title: text, status: 'todo' })
    }
  }
  return steps
}

/** Step stats: done count, total, percentage, whether any step is warn. */
export function stepStats(steps) {
  const list = Array.isArray(steps) ? steps : []
  const done = list.filter((s) => s.status === 'done').length
  const total = list.length
  return {
    done, total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    hasWarn: list.some((s) => s.status === 'warn' || s.status === 'bad'),
    hasBad: list.some((s) => s.status === 'bad'),
  }
}

/** Name of the step in progress: the first running one, otherwise the first unfinished one; null when all are done. */
export function currentStepLabel(steps) {
  const list = Array.isArray(steps) ? steps : []
  return (list.find((s) => s.status === 'running') ?? list.find((s) => s.status !== 'done'))?.title ?? null
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Relative reset time (abbreviated English): "resets in 25m", "resets in 2h", or "resets Fri" when more than a day away. */
export function relativeReset(iso, nowMs) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const min = Math.max(0, Math.round((t.getTime() - nowMs) / 60000))
  if (min < 60) return 'resets in ' + min + 'm'
  if (min < 24 * 60) return 'resets in ' + Math.round(min / 60) + 'h'
  return 'resets ' + WEEKDAYS_EN[t.getDay()]
}

/**
 * Estimated remaining time (minutes) = average duration of completed steps × remaining step count.
 * Returns null when no step is done yet or there is no timing data (shown as "estimating").
 */
export function estimateRemainingMin(progress, nowMs) {
  const steps = progress?.steps ?? []
  const done = steps.filter((s) => s.status === 'done' && typeof s.doneAt === 'number')
  const remaining = steps.filter((s) => s.status !== 'done').length
  if (done.length === 0 || typeof progress?.startedAt !== 'number') return null
  if (remaining === 0) return 0
  const lastDone = Math.max(...done.map((s) => s.doneAt))
  const avgMs = Math.max(0, lastDone - progress.startedAt) / done.length
  return Math.max(1, Math.ceil((avgMs * remaining) / 60000))
}

/** Remaining time (abbreviated English): "~18m", "~1h 15m"; null = cannot estimate yet (returns an empty string), 0 = finished. */
export function etaText(min) {
  if (min === null || min === undefined) return ''
  if (min === 0) return 'done'
  if (min < 60) return '~' + min + 'm'
  const m = min % 60
  return '~' + Math.floor(min / 60) + 'h' + (m ? ' ' + m + 'm' : '')
}

/** Thin progress bar for the terminal (Desktop draws an Svg instead). */
export function thinBar(pct, width = BAR_WIDTH) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0))
  const filled = Math.round((clamped / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

// ===== Desktop graphics (Svg); color codes come from the Claude desktop sidebar design mockup =====

// Colors (edit here)
export const COLORS = { done: '#2f8f4e', warn: '#e07a10', bad: '#c8222b', running: '#0088b0', todo: '#a9a5a3', track: '#8883', line: '#8885' }
export const LIMIT_WARN_PCT = 80  // Usage >= this value turns the bar orange
export const LIMIT_BAD_PCT = 95   // Usage >= this value turns the bar red

/** Usage bar color: blue normally, orange when high, red when nearly full. */
export function limitColor(pct) {
  if (pct >= LIMIT_BAD_PCT) return COLORS.bad
  if (pct >= LIMIT_WARN_PCT) return COLORS.warn
  return COLORS.running
}

/** 4px thin progress bar (mockup style: square corners, light gray track). */
export function svgThinBar(pct, fill, width = 280, height = 4) {
  const w = Math.round((Math.max(0, Math.min(100, Number(pct) || 0)) / 100) * width)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${COLORS.track}"/>` +
    (w > 0 ? `<rect width="${w}" height="${height}" fill="${fill}"/>` : '') + '</svg>'
}

const NODE_LINE_PX = 24 // Height of one text row beside a node (px); NODE_HEIGHT is two rows (edit here)

/** Height of a timeline node whose text takes `lines` rows, so the connector still reaches the next node when a title wraps. */
export function nodeHeight(lines) {
  return Math.max(NODE_HEIGHT, lines * NODE_LINE_PX)
}

export const NODE_HEIGHT = 48 // Height of each timeline node (px). Must be ≥ the height of one text row (title + one line of description) so the lines of adjacent nodes connect (edit here)
const LINE_DONE = '#2f8f4e'
const LINE_TODO = '#ffffff40'

/**
 * One timeline node: the dot sits in the center, with a connector segment above and below.
 * kind: done / running / todo / warn / bad / collapsed (N steps done) / more (N more steps).
 * label: text inside the dot (✓, step number, !, …). top / bottom: colors of the upper and lower segments, null = not drawn (the first node has no upper line, the last has no lower line).
 */
export function svgTimelineNode(kind, label, top, bottom, height = NODE_HEIGHT) {
  const cx = 14
  const cy = height / 2
  const r = 11
  const parts = []
  if (top) parts.push(`<rect x="${cx - 1.5}" y="0" width="3" height="${cy}" fill="${top}"/>`)
  if (bottom) parts.push(`<rect x="${cx - 1.5}" y="${cy}" width="3" height="${height - cy}" fill="${bottom}"/>`)
  const fill = { done: COLORS.done, collapsed: COLORS.done, running: COLORS.running, warn: COLORS.warn, bad: COLORS.bad }[kind]
  if (kind === 'running') parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="${COLORS.running}" fill-opacity="0.25"/>`)
  if (fill) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`)
  } else {
    // Not started / N more steps: hollow circle (filled with the background color first to cover the line passing through); "N more steps" uses a dashed stroke
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1f1f1e" stroke="${COLORS.todo}" stroke-width="2"${kind === 'more' ? ' stroke-dasharray="3 3"' : ''}/>`)
  }
  const color = fill ? '#ffffff' : COLORS.todo
  parts.push(`<text x="${cx}" y="${cy + 4}" font-size="11" font-weight="600" text-anchor="middle" font-family="system-ui,sans-serif" fill="${color}">${esc(label)}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="${height}" viewBox="0 0 28 ${height}">${parts.join('')}</svg>`
}

/**
 * Lays out the fitSteps result as a list of timeline nodes: [N steps done] → shown steps → [N more steps].
 * Each node carries its upper/lower line colors: green when both adjacent nodes are completed kinds (done / collapsed), otherwise gray; the first node has no upper line and the last has no lower line.
 */
export function timelineItems(fit) {
  const items = []
  if (fit.doneCollapsed > 0) items.push({ kind: 'collapsed', label: '✓', text: t('doneCollapsed', fit.doneCollapsed) })
  for (const { step, index } of fit.shown) {
    const kind = STEP_STATUSES.includes(step.status) ? step.status : 'todo'
    const label = kind === 'done' ? '✓' : kind === 'warn' || kind === 'bad' ? '!' : String(index + 1)
    items.push({ kind, label, step, index })
  }
  if (fit.more > 0) items.push({ kind: 'more', label: '…', text: t('moreSteps', fit.more) })
  const isDone = (it) => it && (it.kind === 'done' || it.kind === 'collapsed')
  const seg = (a, b) => (a && b ? (isDone(a) && isDone(b) ? LINE_DONE : LINE_TODO) : null)
  return items.map((it, i) => ({ ...it, top: seg(items[i - 1], it), bottom: seg(it, items[i + 1]) }))
}

// ===== Desktop session records and jump links =====

// Desktop jump links only accept ids of this form (taken from the Desktop app's link handler)
const DESKTOP_ID = /^local_[A-Za-z0-9-]{1,64}$/

/** Builds a jump link for a Desktop session id; returns null when the id format is invalid. */
export function jumpUrl(desktopId) {
  // Same form as the link the desktop app gives for a session (2026-10-21); the older claude://code/continue?session= form switched noticeably slower
  return DESKTOP_ID.test(String(desktopId ?? '')) ? 'claude://claude.ai/epitaxy/' + desktopId : null
}

/** Whether a Desktop session record (%APPDATA%\Claude\claude-code-sessions\…\local_*.json) belongs to this Claude Code session. */
export function desktopRecordMatches(record, cliId) {
  if (!record || !cliId) return false
  return record.cliSessionId === cliId || (Array.isArray(record.priorCliSessionIds) && record.priorCliSessionIds.includes(cliId))
}

/** Takes the last title from the transcript (jsonl): custom-title first, ai-title only if there is none. */
export function titleFromTranscript(text) {
  const s = String(text ?? '')
  const last = (re) => {
    let found = null
    for (const m of s.matchAll(re)) found = m[1]
    return found
  }
  const raw = last(/"customTitle":"((?:[^"\\]|\\.)*)"/g) ?? last(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)
  if (raw === null) return null
  try {
    return JSON.parse('"' + raw + '"')
  } catch {
    return raw
  }
}

// ===== Second line of other sessions, and dividers =====

/** Second line of another session (Desktop): the progress bar stretches almost to the right edge (same width as the usage bars and dividers); the percentage moves to the first line. */
export function svgOtherLine(pct, width = 280) {
  if (typeof pct !== 'number') return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16"></svg>`
  const w = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16">` +
    `<rect x="0" y="6" width="${width}" height="4" rx="2" fill="${COLORS.track}"/>` +
    (w > 0 ? `<rect x="0" y="6" width="${w}" height="4" rx="2" fill="${COLORS.running}"/>` : '') + '</svg>'
}

/** Blank row between other sessions (Desktop): a very faint thin line in the middle. */
export function svgSessionGap(width = 280) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16"><rect x="0" y="8" width="${width}" height="1" fill="#ffffff18"/></svg>`
}

/** Escapes & < > before putting text into an Svg, so names or titles can't break the image. */
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Section divider (Desktop): thick solid line with the title text embedded in the middle. */
export function svgSectionDivider(label, width = 280) {
  const textW = 84
  const side = Math.max(10, Math.round((width - textW) / 2))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16">` +
    `<rect x="0" y="7" width="${side - 6}" height="3" fill="#ffffff66"/>` +
    `<text x="${width / 2}" y="12" font-size="11" text-anchor="middle" font-family="system-ui,sans-serif" fill="#9a988f">${esc(label)}</text>` +
    `<rect x="${width - side + 6}" y="7" width="${side - 6}" height="3" fill="#ffffff66"/></svg>`
}

// ===== Show the current action automatically when no steps are reported =====

export const ACTIVITY_AFTER_MS = 60 * 1000 // When a turn runs longer than this without reporting through the progress tool, show the current action automatically (edit here)
export const ACTIVITY_KEEP = 3             // Keep only this many most recent actions

const baseName = (p) => folderName(p)
const short = (s, n = 40) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// Text that looks like a path, command, or secret key (not shown; a generic name is used instead)
const UNSAFE_TEXT = [
  /[A-Za-z]:[\\/]/,          // Windows path C:\ or C:/
  /(^|\s)[~.]?\/[\w.-]+\//,   // Unix path /a/b/, ~/x/, ./x/
  /\|\||\||&&|;|>|<|`|\$\(/,   // Pipes, chaining, redirection, subcommands
  /(^|\s)--?[A-Za-z]/,        // Command flags -x, --flag
  /=/,                       // Assignment (environment variables, argument values)
  /[A-Za-z0-9_\-]{24,}/,      // Long alphanumeric run, likely a key or hash
]

/** Shows the description only when it is safe (truncated), otherwise returns fallback; keeps paths, commands, and keys off the panel. */
export function safeText(text, fallback, max = 40) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t || UNSAFE_TEXT.some((re) => re.test(t))) return fallback
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/**
 * Tool call → a human-readable action name. Uses only the file name and the tool's own short description (sanitized first);
 * never shows the full path or the command contents (which may contain passwords or keys).
 */
export function actionLabel(e) {
  const tool = String(e?.tool ?? '')
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool)) return t('actEdit', baseName(e.file_path ?? e.notebook_path ?? ''))
  if (tool === 'Read') return t('actRead', baseName(e.file_path ?? ''))
  if (tool === 'Bash' || tool === 'PowerShell') {
    return t('actRun', safeText(e.description, ''))
  }
  if (tool === 'Grep' || tool === 'Glob') return t('actSearch')
  if (tool === 'WebFetch' || tool === 'WebSearch') return t('actWeb')
  if (tool === 'Agent' || tool === 'Task') {
    return t('actAgent', safeText(e.description, ''))
  }
  return t('actTool', tool)
}

/** Puts the new action first and keeps only the most recent ACTIVITY_KEEP entries. */
export function pushAction(actions, label, at) {
  return [{ label, at }, ...(Array.isArray(actions) ? actions : [])].slice(0, ACTIVITY_KEEP)
}

/** Elapsed time (abbreviated English): "1m 12s", or "9s" under 1 minute. */
export function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(sec / 60)
  return m > 0 ? m + 'm ' + (sec % 60) + 's' : sec + 's'
}

/** Whether to show automatic activity: working, past the threshold, and no progress-tool steps in this turn. */
export function showActivity(activity, hasToolSteps, nowMs, afterMs = ACTIVITY_AFTER_MS) {
  return !!activity && typeof activity.startedAt === 'number' && !hasToolSteps && nowMs - activity.startedAt >= afterMs
}

// ===== Single-page layout (count rows first and draw only what fits, instead of relying on truncation) =====

// Estimated rows per element (edit here). Desktop dots / thin bars are images whose real height can't be measured, so estimate conservatively: better to leave blank space than get a scrollbar
export const ROWS = { step: 2, other: 2, limit: 2 }
export const FALLBACK_BUDGET = 12 // Conservative value used when the available row count is unknown

/** Rows of the usage block: 2 rows per bar, 1 blank row between bars; 1 row when there is no data. */
export function usageRows(count) {
  return count === 0 ? 1 : count * ROWS.limit + (count - 1)
}

export const WINDOW_SIZE = 5 // Max steps shown in the current-step area (centered on the current step; edit here)

/**
 * Centered on the "current step" (the first running one, otherwise the first unfinished one), takes the nearest WINDOW_SIZE steps (2 before + current + 2 after; near an edge, the other side is extended).
 * When they don't fit, shrinks from the end farthest from the center; the current step is always kept.
 * Returns { doneCollapsed (completed steps not shown), shown: [{ step, index }], more (unfinished steps not shown) }, with total rows ≤ maxRows.
 */
export function fitSteps(steps, maxRows) {
  const list = Array.isArray(steps) ? steps : []
  const n = list.length
  const doneTotal = list.filter((s) => s.status === 'done').length
  let center = list.findIndex((s) => s.status === 'running')
  if (center === -1) center = list.findIndex((s) => s.status !== 'done')
  if (center === -1) return { doneCollapsed: doneTotal, shown: [], more: 0 } // All done
  const half = Math.floor(WINDOW_SIZE / 2)
  let lo = Math.max(0, center - half)
  let hi = Math.min(n - 1, lo + WINDOW_SIZE - 1)
  lo = Math.max(0, hi - WINDOW_SIZE + 1)
  const cost = (a, b) => {
    const inside = list.slice(a, b + 1)
    const doneOut = doneTotal - inside.filter((s) => s.status === 'done').length
    const moreOut = (n - doneTotal) - inside.filter((s) => s.status !== 'done').length
    return (inside.length + (doneOut > 0 ? 1 : 0) + (moreOut > 0 ? 1 : 0)) * ROWS.step
  }
  while (lo <= hi && cost(lo, hi) > maxRows) {
    if (lo === hi) { lo = hi + 1; break } // Not even the current step fits
    if (center - lo >= hi - center) lo++
    else hi--
  }
  const shown = lo <= hi ? list.slice(lo, hi + 1).map((step, i) => ({ step, index: lo + i })) : []
  if (shown.length === 0) return { doneCollapsed: 0, shown: [], more: 0 } // Not even the current step fits, so the collapsed nodes aren't drawn either (they each take ROWS.step rows)
  const doneCollapsed = doneTotal - shown.filter((x) => x.step.status === 'done').length
  const more = (n - doneTotal) - shown.filter((x) => x.step.status !== 'done').length
  return { doneCollapsed, shown, more }
}


/** Rows of the other-sessions block: 1 divider + ROWS.other rows each + 1 blank row between them + 1 row for "…N more". */
export function othersRows(shown, total) {
  if (shown === 0) return 0
  return 1 + shown * ROWS.other + (shown - 1) + (total > shown ? 1 : 0)
}

/** Title cleanup: strips quotes, punctuation, and line breaks. */
export function cleanTitle(text) {
  // Only strips quotes, punctuation, and extra lines; never truncates (a name cut in half is unreadable). Overlong names are left to nameUnits to detect, then the model is asked to rename
  return String(text ?? '').split(/\r?\n/)[0].replace(/["'「」『』《》“”‘’*`#]/g, '').replace(/[。．.！!？?：:]+$/, '').trim()
}

/** Name length: one English word (or a run of digits) counts as 1 unit, each CJK character counts as 1 unit, whitespace and symbols don't count. */
export function nameUnits(text) {
  return (String(text ?? '').match(/[A-Za-z0-9]+(?:[-_.'][A-Za-z0-9]+)*|[^\sA-Za-z0-9\p{P}\p{S}]/gu) ?? []).length
}

// ===== Status lights =====

// Light colors (edit here): problem needing attention = red light, severe problem = red triangle icon, in progress = blue, finished but unread = orange, seen = gray hollow; there is no green light by design
// Order of other sessions: what needs the user first, then finished-but-unseen, then working, then seen
const URGENCY_RANK = { bad: 0, warn: 0, unread: 1, working: 2, idle: 3 }

/** Most recent activity time of a session, used to order sessions within one urgency level. */
function lastActivity(s) {
  return Math.max(s?.finishedAt ?? 0, s?.workStartedAt ?? 0, s?.firstSeen ?? 0)
}

/** Sort other sessions by urgency (URGENCY_RANK), the most recently active first within a level. */
export function sortByUrgency(list) {
  return [...list].sort((a, b) => (URGENCY_RANK[statusOf(a)] - URGENCY_RANK[statusOf(b)]) || (lastActivity(b) - lastActivity(a)) || String(a.id).localeCompare(String(b.id)))
}

/** Group key of a session name: the part before the first "-" (the naming rule puts the purpose after it). */
export function groupKey(name) {
  return String(name ?? '').split('-')[0].trim()
}

/**
 * Lay out sorted sessions as rows: sessions that need the user stay at the top, ungrouped;
 * the rest are grouped by groupKey when 2 or more share it, the group placed where its first member falls.
 * Returns items { type: 'header', key, name, count } or { type: 'row', s }.
 */
export function groupSessions(sorted) {
  const urgent = sorted.filter((s) => URGENCY_RANK[statusOf(s)] === 0)
  const rest = sorted.filter((s) => URGENCY_RANK[statusOf(s)] !== 0)
  const counts = new Map()
  for (const s of rest) counts.set(groupKey(s.name), (counts.get(groupKey(s.name)) ?? 0) + 1)
  const items = urgent.map((s) => ({ type: 'row', s }))
  const placed = new Set()
  for (const s of rest) {
    const key = groupKey(s.name)
    if ((counts.get(key) ?? 0) < 2) { items.push({ type: 'row', s }); continue }
    if (placed.has(key)) continue
    placed.add(key)
    const members = rest.filter((m) => groupKey(m.name) === key)
    items.push({ type: 'header', key, name: key, count: members.length }, ...members.map((m) => ({ type: 'row', s: m })))
  }
  return items
}

/** The one line shown under a session while the pointer is on it: { kind: 'stuck' | 'doing' | 'done', text }, or null when there is nothing to say. */
export function hoverInfo(s) {
  const status = statusOf(s)
  if (status === 'bad' || status === 'warn') {
    const text = s.alertNote || s.stepLabel
    return text ? { kind: 'stuck', text } : null
  }
  if (status === 'working') {
    const text = s.stepLabel || s.activity?.current
    return text ? { kind: 'doing', text } : null
  }
  return s.lastDoneLabel ? { kind: 'done', text: s.lastDoneLabel } : null
}

export const LIGHT = { bad: '#c8222b', warn: '#c8222b', working: '#0088b0', unread: '#e07a10', idle: '#77756f' }

/** Icon for a severe problem (work may be unable to continue): red-outlined rounded triangle + exclamation mark, replacing the status dot. */
export function svgAlertIcon(color = LIGHT.bad, size = 16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">`
    + `<path d="M12 3.5 L21.5 20 H2.5 Z" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`
    + `<path d="M12 9.5 V14" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`
    + `<circle cx="12" cy="17.2" r="1.3" fill="${color}"/></svg>`
}

/** Status of another session: bad / warn / working (including background) / unread (finished but not opened yet) / idle. */
export function statusOf(s) {
  const stats = s?.stats ?? {}
  if (stats.hasBad) return 'bad'
  if (stats.hasWarn) return 'warn'
  if (s?.isWorking || s?.background) return 'working'
  const seen = Math.max(s?.lastFocusedAt ?? 0, s?.seenAt ?? 0)
  if (typeof s?.finishedAt === 'number' && s.finishedAt > seen) return 'unread'
  return 'idle'
}

/** Right-side time: while working, shows the remaining time if it can be computed; once stopped, shows how long ago it finished (using the work end time, not the heartbeat time). */
export function rightTime(s, nowMs) {
  const busy = s?.isWorking || s?.background
  if (busy) return s?.hasToolSteps && s?.eta ? s.eta : ''
  return typeof s?.finishedAt === 'number' ? ago(s.finishedAt, nowMs) : ''
}

// ===== Background work =====

// type of background_tasks (official BackgroundTaskSummary) → the localized fallback name (i18n key) used when there is no description
const BG_TYPE_KEY = { shell: 'bgShell', subagent: 'bgSubagent', monitor: 'bgMonitor', workflow: 'bgWorkflow' }

/**
 * background_tasks from classic.Stop → { count, current }; returns null when empty or missing.
 * Uses only the sanitized description, never the command contents (which may contain passwords or keys).
 */
export function summarizeBackground(tasks) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t === 'object') : []
  if (list.length === 0) return null
  const first = list[0]
  const fallback = t(BG_TYPE_KEY[first.type] ?? 'bgOther')
  return { count: list.length, current: safeText(first.description, fallback) }
}

// ===== Hide other projects =====

/**
 * Splits other sessions into "visible" and "hidden" according to the hide record ({ [sessionId]: { at } }).
 * This is an "untrack": after ✕ is pressed the session is no longer shown; it only comes back once that session has been opened afterwards (lastFocusedAt > the untrack time),
 * and is then listed in unhide so the caller can clear the record. Starting a new turn on its own or finishing background work does not bring it back.
 * hiddenCount only counts sessions that are still open (others already excludes expired ones).
 */
export function splitHidden(others, hidden) {
  const map = hidden && typeof hidden === 'object' ? hidden : {}
  const visible = []
  const unhide = []
  let hiddenCount = 0
  for (const s of others) {
    const h = map[s.id]
    if (!h) {
      visible.push(s)
    } else if (typeof s.lastFocusedAt === 'number' && s.lastFocusedAt > h.at) {
      visible.push(s)
      unhide.push(s.id)
    } else {
      hiddenCount += 1
    }
  }
  return { visible, hiddenCount, unhide }
}

/** How long ago (abbreviated English): "just now", "40m ago", "2h 5m ago", "1d 3h ago". */
export function ago(ms, nowMs) {
  const min = Math.max(0, Math.floor((nowMs - ms) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return min + 'm ago'
  const h = Math.floor(min / 60)
  if (h < 24) return h + 'h' + (min % 60 ? ' ' + (min % 60) + 'm' : '') + ' ago'
  const d = Math.floor(h / 24)
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '') + ' ago'
}

// ===== Auto-naming looks at the whole session =====

/**
 * Condenses the whole session into text for a small model to name it: every user message (up to 300 chars each) + the first Claude reply right after it (up to 150 chars);
 * the tool activity in between is left out (too much would push out the earlier topic). When over budget chars, keeps the first 2 turns (the topic is usually at the start) and the most recent turns.
 */
export function conversationDigest(messages, budget = 6000) {
  const turns = []
  for (const m of messages ?? []) {
    if (!m || typeof m.text !== 'string' || m.text.trim() === '') continue
    if (m.role === 'user') turns.push({ user: m.text.trim().slice(0, 300), reply: null })
    else if (turns.length > 0 && turns.at(-1).reply === null) turns.at(-1).reply = m.text.trim().slice(0, 150)
  }
  const lines = turns.map((turn) => t('digestUser') + turn.user + (turn.reply ? '\n' + t('digestClaude') + turn.reply : ''))
  const join = (list) => list.join('\n')
  if (join(lines).length <= budget) return join(lines)
  const head = lines.slice(0, 2)
  const tail = []
  for (let i = lines.length - 1; i >= 2; i--) {
    if (join([...head, '…', lines[i], ...tail]).length > budget) break
    tail.unshift(lines[i])
  }
  return join([...head, '…', ...tail]).slice(0, budget)
}

// ===== Wrapping long text =====

/** Wraps by display width: CJK characters count as 2 cells, others as 1; drops no characters, for name buttons where "every line must be clickable". */
export function wrapByWidth(text, cells) {
  const width = (str) => [...str].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e7f ? 2 : 1), 0)
  const lines = []
  let line = ''
  for (const ch of String(text ?? '')) {
    if (width(line + ch) > cells && line !== '') {
      // A space that does not fit ends the line (it hangs past the edge, unseen) instead of starting the next one
      if (ch === ' ') {
        lines.push(line + ch)
        line = ''
        continue
      }
      // Otherwise break after the last space when there is one, so English words stay whole
      const cut = line.lastIndexOf(' ')
      if (cut >= 0 && cut < line.length - 1) {
        lines.push(line.slice(0, cut + 1))
        line = line.slice(cut + 1)
      } else {
        lines.push(line)
        line = ''
      }
    }
    line += ch
  }
  if (line !== '' || lines.length === 0) lines.push(line)
  return lines
}
