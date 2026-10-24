// session-dashboard: Sessions pane — a timeline of the current session's steps, a list of other sessions with status lights, and usage pinned at the bottom. Above the prompt there is only a button that opens the pane.
// Step data comes from the plugin's `progress` tool (preferred), falling back to checklist.md / TASKS.md in the working folder.
// Cross-session data lives in $.store (shared by every session on this machine); each session writes only its own keys, so sessions never overwrite each other.
// Rendering (ui.render) is read-only; cleanup and publishing happen on the heartbeat or in event hooks.
import { setLang, t } from './i18n.js'
import {
  etaText, estimateRemainingMin, folderName, jumpUrl, liveSessions, mergeProgress, parseTaskSteps,
  STALE_MS, stepStats, svgTimelineNode, svgThinBar, limitColor, tasksPath, CHECKLIST_FILES, othersSignature, thinBar, titleFromTranscript, usageSegments,
  desktopRecordMatches, currentStepLabel, splitHidden, COLORS, ago,
  actionLabel, pushAction, showActivity, summarizeBackground,
  ROWS, FALLBACK_BUDGET, usageRows, fitSteps, othersRows,
  LIGHT, statusOf, rightTime, svgOtherLine, svgSectionDivider, svgSessionGap, timelineItems, cleanTitle, nameUnits, wrapByWidth, touchesChecklist, nodeHeight, isProjectSession, projectTag, clientRowMode, sortByUrgency, groupSessions, hoverInfo, svgAlertIcon, conversationDigest, todosToInput,
} from './lib.js'

// ===== Tunables (edit here) =====
const PANE_ID = 'session-dashboard'
const KEY_PREFIX = 'session:'          // $.store: per-session summary (shown in other sessions' panes)
const HIDDEN_PREFIX = 'hidden:'        // $.store: one entry { at } per hidden session (no whole-object read-modify-write, so sessions cannot overwrite each other)
const LEGACY_HIDDEN_KEY = 'hidden'     // Legacy single-object hidden record; still read, and migrated to per-session keys on the heartbeat
const USAGE_KEY = 'usage:last'         // $.store: latest usage reading (account-wide; used by new sessions that have no reading yet)
const USAGE_STALE_MS = 5 * 60 * 1000   // When showing another session's reading older than this, label it with the reading time
const PROGRESS_PREFIX = 'progress:'    // $.store: the full step list each session reported through the progress tool
const HEARTBEAT_MS = 30 * 1000         // How often to publish own state, re-read TASKS.md and prune stale data
const CHANGE_CHECK_MS = 10 * 1000      // How often to check other sessions for changes (redraw only on change)
const TIME_REDRAW_MS = 60 * 1000       // How often time labels (~18m, 3m ago) and usage are redrawn (1 minute by design)
const FOCUS_REFRESH_MS = 10 * 1000     // How often to check Desktop's "last focused" time (drives the finished-unread light)
const TITLE_REFRESH_MS = 60 * 1000     // How often to re-read the session name (a rename shows up within 60 s)
const TRANSCRIPT_MAX_BYTES = 4 * 1024 * 1024 // $.fs.read per-file limit is 4 MiB (official Limits table)
const PROGRESS_TOOL = 'mcp__session-dashboard__progress'
const TODO_TOOL = 'TodoWrite'                 // Claude's built-in todo list; its input is { todos: [{ content, status }] }
const ACTIVITY_PUBLISH_MS = 10 * 1000  // Activity is written to the shared store at most once every 10 s
const AUTO_OPEN = true                 // Open the pane automatically when a session starts
const PANE_BUTTON_LABEL = '☰ Sessions' // Label of the open-pane button above the prompt
// Auto-naming: after turn RENAME_AFTER_TURNS, a small model picks a name of at most TITLE_MAX units, once per session; manually renamed sessions are left alone
const AUTO_RENAME = true               // Set to false to turn auto-naming off
const RENAME_AFTER_TURNS = 2 // The user asked for 2 (2026-10-20): 3 turns felt too long
const TITLE_MAX = 6                   // Longest name in units; a name with a "-purpose" suffix may add SUFFIX_MAX more (user's rule, 2026-10-19: the noun for the thing, nothing else)
const SUFFIX_MAX = 3
const PROJECT_TAG_CHARS = 2              // Sessions started by the project system get "-<first N characters of the folder name>" (user's rule, 2026-10-21)
const RENAME_MODEL = 'haiku'
const RENAME_TOOL = 'mcp__ccd_session_mgmt__set_session_title' // Desktop's official rename tool (records the title source as "tool")
const RENAMED_PREFIX = 'renamed:'      // $.store: sessions already auto-named (guarantees a single attempt, no retry on failure)
const TASK_LABEL_MAX = 12            // Max length of the current-task summary (edit here)
const NAME_RESERVED_CELLS = 16         // Cells taken on an other-session name line by ✕, the light and the right-hand time (approx.)
const OWNS_PREFIX = 'checklist:'        // $.store: sessions that wrote a checklist file themselves (only those show it as their steps)
const NODE_WRAP_MARGIN = 3            // Cells taken off the estimated text width so wrapped lines are not under-counted (2026-10-21: a 3-line note was drawn with a gap)
const STEP_RESERVED_CELLS = 6          // Cells taken by the timeline node and gap to the left of a step's text
const CLICK_LOG_KEY = 'click-log'           // Last clicks on session blocks, kept so a real click in the app can be checked afterwards
const CLICK_LOG_MAX = 20
const CLIENT_GRACE_MS = 12000              // How long a session block may take to report that its region runs before plain rows are drawn instead (the app gives up on a region after 10 s)
const HOVER_BG = '#88888833'                 // Row background while the pointer is on any part of a session (translucent gray works in light and dark)
const SECTION_GAP = 3                  // Blank lines between the current session and "other sessions" (shrinks first when space is tight)

// Icon and text colour per step status (terminal; Desktop draws timeline dots)
const STEP_LOOK = {
  done: { icon: '✓', color: 'green' },
  running: { icon: '●', color: 'cyan' },
  warn: { icon: '⚠', color: 'yellow' },
  bad: { icon: '⛔', color: 'red' },
  todo: { icon: '○', color: undefined },
}

// State of this session; reset when the module reloads, refilled by session.start
const me = {
  id: '', cwd: '', isWorking: false, workStartedAt: null, finishedAt: null, seenAt: null,
  activity: null, activityPublishedAt: 0, background: null, firstSeen: null, queuedHinted: false,
  title: null, desktopId: null, desktopFile: null, titleCheckedAt: 0,
  lastFocusedAt: null, focusFileMtime: 0, timers: [], titleSource: null, fromProject: false, pendingTitle: null, taskLabel: null, lastSignature: null, ownsChecklist: false,
}

// ---------- Reading files ----------

/** Read checklist.md in the working folder (falling back to TASKS.md) and convert it to steps; null if neither exists. */
async function readTaskSteps($, cwd) {
  for (const name of CHECKLIST_FILES) {
    try {
      return parseTaskSteps(await $.fs.read(tasksPath(cwd, name)))
    } catch {}
  }
  return null
}

/** Redraw only when other sessions or the hidden list changed; ever-changing values such as the heartbeat time do not count. */
async function redrawIfChanged($) {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  const sig = othersSignature(await loadOthers($, now), keys.filter((k) => k.startsWith(HIDDEN_PREFIX)))
  if (me.lastSignature !== null && sig !== me.lastSignature) $.ui.invalidate('ui.render')
  me.lastSignature = sig
}

/** Read and parse a JSON file; null on failure. */
async function readJson($, path) {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

/** List all Desktop session record files (%APPDATA%\Claude\claude-code-sessions\<acc>\<org>\local_*.json), newest first. */
async function listDesktopRecords($) {
  const appData = await $.env.get('APPDATA')
  if (!appData) return []
  const root = appData + '\\Claude\\claude-code-sessions'
  const files = []
  try {
    for (const a of await $.fs.list(root)) {
      if (a.kind !== 'dir') continue
      for (const b of await $.fs.list(root + '\\' + a.name)) {
        if (b.kind !== 'dir') continue
        const dir = root + '\\' + a.name + '\\' + b.name
        for (const f of await $.fs.list(dir)) {
          if (f.kind === 'file' && f.name.startsWith('local_') && f.name.endsWith('.json')) files.push({ path: dir + '\\' + f.name, mtimeMs: f.mtimeMs })
        }
      }
    }
  } catch {
    return []
  }
  return files.sort((x, y) => y.mtimeMs - x.mtimeMs)
}

/** Find this session's record in the Desktop app: try the remembered path first, otherwise scan all records newest first and stop at the first match (no cap on how many are scanned). */
async function findDesktopRecord($) {
  if (me.desktopFile) {
    const record = await readJson($, me.desktopFile)
    if (desktopRecordMatches(record, me.id)) return record
    me.desktopFile = null
  }
  for (const f of await listDesktopRecords($)) {
    const record = await readJson($, f.path)
    if (desktopRecordMatches(record, me.id)) {
      me.desktopFile = f.path
      return record
    }
  }
  return null
}

/** Get the name from the transcript (~/.claude/projects/<project>/<id>.jsonl); give up if the file exceeds 4 MiB (never read the whole file). */
async function transcriptTitle($) {
  const home = await $.env.get('USERPROFILE')
  if (!home) return null
  const projects = home + '\\.claude\\projects'
  try {
    for (const d of await $.fs.list(projects)) {
      if (d.kind !== 'dir') continue
      const path = projects + '\\' + d.name + '\\' + me.id + '.jsonl'
      if (!(await $.fs.exists(path))) continue
      const stat = await $.fs.stat(path)
      if (stat.size > TRANSCRIPT_MAX_BYTES) return null
      return titleFromTranscript(await $.fs.read(path))
    }
  } catch {
    return null
  }
  return null
}

/** Refresh the session name, Desktop id and last-focused time: Desktop record → transcript → folder name. At most once per TITLE_REFRESH_MS. */
async function refreshTitle($, now) {
  if (now - me.titleCheckedAt < TITLE_REFRESH_MS) return
  me.titleCheckedAt = now
  const record = await findDesktopRecord($)
  if (record) {
    me.title = typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : null
    me.desktopId = record.sessionId ?? null
    me.titleSource = record.titleSource ?? null
    me.fromProject = isProjectSession(record)
    if (typeof record.lastFocusedAt === 'number') me.lastFocusedAt = record.lastFocusedAt
  }
  if (!me.title) me.title = await transcriptTitle($)
}

/**
 * Check Desktop's "last focused" time (lastFocusedAt). Measured (2026-10-08): switching to a session writes it to that session's record file within 1 s,
 * but staying on the same session never updates it again. Re-read only when the file's mtime changed, to avoid reading several hundred KB every 10 s.
 * Returns whether it changed.
 */
async function refreshFocus($) {
  if (!me.desktopFile) return false
  try {
    const stat = await $.fs.stat(me.desktopFile)
    if (stat.mtimeMs === me.focusFileMtime) return false
    me.focusFileMtime = stat.mtimeMs
    const record = await readJson($, me.desktopFile)
    if (typeof record?.lastFocusedAt === 'number' && record.lastFocusedAt !== me.lastFocusedAt) {
      me.lastFocusedAt = record.lastFocusedAt
      return true
    }
  } catch {
    // Unreadable: keep the previous value
  }
  return false
}

/** Current steps of this session: progress-tool data first, otherwise TASKS.md. */
async function currentSteps($) {
  const progress = me.id ? await $.store.get(PROGRESS_PREFIX + me.id) : null
  if (progress && Array.isArray(progress.steps) && progress.steps.length > 0) return { progress, steps: progress.steps, source: 'tool' }
  // A checklist in the working folder may belong to another session in the same folder, or be a general to-do list:
  // show it only when this session has written to it
  const steps = me.ownsChecklist ? await readTaskSteps($, me.cwd) : null
  return { progress: null, steps: steps ?? [], source: steps ? 'tasks' : null }
}

// ---------- Shared store ----------

/** Write own summary to the shared store for other sessions' panes. */
/** Store a full step list for this session (empty clears it) and redraw; makeInput(prev) builds the progress-tool input. */
async function saveProgress($, makeInput) {
  const now = await $.clock.now()
  const prev = await $.store.get(PROGRESS_PREFIX + me.id)
  const progress = mergeProgress(prev, makeInput(prev), now)
  if (progress.steps.length === 0) await $.store.delete(PROGRESS_PREFIX + me.id)
  else await $.store.set(PROGRESS_PREFIX + me.id, progress)
  await publish($)
  $.ui.invalidate('ui.render')
  return progress
}

async function publish($) {
  if (!me.id) return // After /clear and before the new id is adopted, do not publish, so no ghost data is written under the old id
  const now = await $.clock.now()
  await refreshTitle($, now)
  const { progress, steps, source } = await currentSteps($)
  await $.store.set(KEY_PREFIX + me.id, {
    id: me.id,
    name: me.title ?? folderName(me.cwd),
    desktopId: me.desktopId,
    isWorking: me.isWorking,
    lastSeen: now,
    firstSeen: me.firstSeen,
    workStartedAt: me.workStartedAt,
    finishedAt: me.finishedAt,
    lastFocusedAt: me.lastFocusedAt,
    seenAt: me.seenAt,
    hasToolSteps: source === 'tool',
    background: me.background,
    activity: me.activity ? { startedAt: me.activity.startedAt, current: me.activity.actions[0]?.label ?? null } : null,
    stats: stepStats(steps),
    eta: source === 'tool' ? etaText(estimateRemainingMin(progress, now)) : null,
    stepLabel: currentStepLabel(steps),
    // Shown under the row when the pointer is on it in other sessions' panes
    alertNote: steps.find((step) => (step.status === 'bad' || step.status === 'warn') && step.note)?.note ?? null,
    lastDoneLabel: [...steps].reverse().find((step) => step.status === 'done')?.title ?? null,
  })
}

/** Load other sessions (read-only; stale ones are skipped, deletion is left to prune on the heartbeat). */
async function loadOthers($, now) {
  const entries = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const entry = await $.store.get(key)
    if (!entry || typeof entry.lastSeen !== 'number' || now - entry.lastSeen > STALE_MS) continue
    // Old records left behind by this session's own previous ids do not count as "other sessions" either
    if (entry.id !== me.id && !(me.desktopId && entry.desktopId === me.desktopId)) entries.push(entry)
  }
  return liveSessions(entries, now)
}

/** Names of every other session in the store (stale ones too: a finished session's name still counts as taken). */
async function otherNames($) {
  const names = new Set()
  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const entry = await $.store.get(key)
    if (entry?.id !== me.id && !(me.desktopId && entry?.desktopId === me.desktopId) && typeof entry?.name === 'string' && entry.name.trim()) names.add(entry.name.trim())
  }
  return [...names]
}

/** Load hidden records { [id]: { at } }: per-session keys plus the legacy single-object record. */
async function loadHidden($) {
  const merged = { ...((await $.store.get(LEGACY_HIDDEN_KEY)) ?? {}) }
  for (const key of await $.store.keys()) {
    if (!key.startsWith(HIDDEN_PREFIX)) continue
    const h = await $.store.get(key)
    if (h && typeof h.at === 'number') merged[key.slice(HIDDEN_PREFIX.length)] = h
  }
  return merged
}

/** Heartbeat cleanup: delete stale sessions, drop hidden records that are due to be unhidden, and migrate the legacy hidden record to per-session keys. */
async function prune($, now) {
  const all = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const entry = await $.store.get(key)
    if (!entry || typeof entry.lastSeen !== 'number' || now - entry.lastSeen > STALE_MS) await $.store.delete(key)
    else all.push(entry)
  }
  const legacy = await $.store.get(LEGACY_HIDDEN_KEY)
  if (legacy && typeof legacy === 'object') {
    for (const [id, h] of Object.entries(legacy)) await $.store.set(HIDDEN_PREFIX + id, h)
    await $.store.delete(LEGACY_HIDDEN_KEY)
  }
  const { unhide } = splitHidden(all, await loadHidden($))
  for (const id of unhide) await $.store.delete(HIDDEN_PREFIX + id)
}

/** Heartbeat: publish own state, then prune. */
async function heartbeat($) {
  await publish($)
  await prune($, await $.clock.now())
}

/**
 * Whether this is the session currently being looked at: its "last focused" time is the newest of all sessions.
 * Used at the moment work finishes: if the session was watched to completion, the "finished, unread" light should not turn on.
 */
async function isFrontSession($, now) {
  await refreshFocus($)
  if (typeof me.lastFocusedAt !== 'number') return false
  for (const s of await loadOthers($, now)) {
    if (typeof s.lastFocusedAt === 'number' && s.lastFocusedAt > me.lastFocusedAt) return false
  }
  return true
}

/** The turn has really ended (no background work): record the finish time; if the session is in front, also mark it as seen. */
async function markFinished($) {
  const now = await $.clock.now()
  me.finishedAt = now
  me.seenAt = (await isFrontSession($, now)) ? now : me.seenAt
}

/** Set working / idle. */
async function setWorking($, isWorking) {
  me.isWorking = isWorking
  if (isWorking) {
    me.workStartedAt = await $.clock.now()
    me.activity = { startedAt: me.workStartedAt, actions: [] }
    me.background = null
    me.finishedAt = null
  } else {
    me.activity = null
  }
}

/** Re-register under the new id after /clear, /resume or /branch. */
async function adoptSessionId($) {
  me.id = await $.session.id()
  me.cwd = await $.session.cwd()
  me.isWorking = false
  me.activity = null
  me.background = null
  me.finishedAt = null
  me.seenAt = null
  me.ownsChecklist = false
  me.firstSeen = await $.clock.now()
  me.titleCheckedAt = 0
  me.desktopFile = null
  me.focusFileMtime = 0
}

/**
 * Auto-naming: after turn RENAME_AFTER_TURNS, pick a name of at most TITLE_MAX units from the conversation, exactly once (the marker is written before the call, so a failure is not retried).
 * How: prefer Desktop's official rename tool (the app code confirms the title source is recorded as "tool"); if it cannot be called, wait for the next submitted prompt and
 * set it via UserPromptSubmit's sessionTitle (works for terminal sessions; whether Desktop honours it is unverified). A manually renamed session (titleSource = user) is left alone; a session started by the project system gets "-<project>" appended.
 */
async function maybeRename($) {
  if (!AUTO_RENAME || !me.id) return
  if (await $.store.get(RENAMED_PREFIX + me.id)) return
  if ((await $.session.turns()) < RENAME_AFTER_TURNS) return
  await $.store.set(RENAMED_PREFIX + me.id, { at: await $.clock.now() })
  me.titleCheckedAt = 0
  await refreshTitle($, await $.clock.now())
  if (me.titleSource === 'user') return
  const convo = conversationDigest(await $.session.messages()) // Uses the whole session, not just the last few messages
  const taken = await otherNames($)
  let title = ''
  try {
    const task = t('renameTask') + (taken.length ? t('existingNames', taken) : '')
    title = await askShortName($, task, convo, TITLE_MAX + (taken.length ? SUFFIX_MAX : 0))
    // Same name as another session: ask once for a "-purpose" suffix so the two can be told apart
    if (title && taken.includes(title)) title = (await askShortName($, t('duplicateName', title), convo, TITLE_MAX + SUFFIX_MAX)) || title
  } catch {
    return
  }
  if (!title) return
  // The project page's own name lives in the cloud and cannot be read, so a project session is named from its content plus which project it belongs to
  if (me.fromProject) {
    const tag = projectTag(me.cwd, PROJECT_TAG_CHARS)
    if (tag && !title.endsWith('-' + tag)) title = title + '-' + tag
  }
  try {
    // A missing tool throws; a rejection (e.g. permissions) returns deny / isError. Both count as failure and take the fallback
    const res = await $.tool.call({ tool: RENAME_TOOL, session_id: 'self', title })
    if (res?.deny || res?.isError) throw new Error(String(res.deny ?? res.result ?? 'rejected'))
    $.ui.log('session-dashboard: renamed to "' + title + '" (Desktop rename tool)', { to: 'debug' })
  } catch (err) {
    me.pendingTitle = title
    $.ui.log('session-dashboard: Desktop rename tool failed (' + String(err) + '), falling back to sessionTitle', { to: 'debug' })
  }
  me.title = title
  await publish($)
}

/**
 * Ask the small model for a complete name of at most max units (an English word counts as 1 unit). An over-long name is not truncated; the model is asked once more;
 * if the retry is still too long, the shorter of the two complete names is used.
 */
async function askShortName($, task, prompt, max) {
  const rule = t('nameRule', max)
  const ask = async (system, text) => {
    const reply = await $.model.complete({ model: RENAME_MODEL, maxTokens: 40, system, prompt: text })
    return reply?.isAnswered ? cleanTitle(reply.text) : ''
  }
  const first = await ask(task + rule, prompt)
  if (!first || nameUnits(first) <= max) return first
  const second = await ask(t('shortenTask') + rule, t('tooLong', first, nameUnits(first)))
  return second && nameUnits(second) < nameUnits(first) ? second : first
}

/** Condense the submitted prompt to at most TASK_LABEL_MAX units, shown in the pane as "what it is doing"; on failure the label stays "working". */
async function summarizeTask($, prompt) {
  try {
    const label = await askShortName($, t('summaryTask'), prompt.slice(0, 1000), TASK_LABEL_MAX)
    if (label) {
      me.taskLabel = label
      $.ui.invalidate('ui.render')
    }
  } catch {}
}

// ---------- Actions ----------

/** Open the pane; asked=true means it was requested explicitly (command or button) and takes keyboard focus. A failed open only shows a toast and never aborts the hook. */
async function openPane($, asked) {
  const pane = { id: PANE_ID, title: 'Sessions' }
  try {
    const opened = await $.ui.open(asked ? { ...pane, focus: true } : pane)
    // When the mod opens the pane itself and there is no room, the pane is queued; hint once how to open it manually
    if (!asked && opened && opened.isPlaced === false && !me.queuedHinted) {
      me.queuedHinted = true
      $.ui.toast(t('queuedHint'), { timeoutMs: 8000 })
    }
  } catch (err) {
    if (asked) $.ui.toast(t('paneOpenFailed', String(err)))
  }
}

/** Jump to another Desktop session via the Desktop app's own claude:// link, which Windows hands to the app. */
async function jumpTo($, url, name) {
  try {
    await $.process.run(['rundll32.exe', 'url.dll,FileProtocolHandler', url])
  } catch (err) {
    $.ui.toast(t('jumpFailed', name, String(err)))
  }
}

/** Hide another session (takes effect in every pane) without touching the session itself. One key per session, so sessions cannot overwrite each other. */
async function hideProject($, id) {
  await $.store.set(HIDDEN_PREFIX + id, { at: await $.clock.now() })
  $.ui.invalidate('ui.render')
}


/**
 * Usage reading (read-only): rateLimits only exists after this session receives its first reply (official typing: "empty … before the first reading").
 * The quota is account-wide; with no reading of its own, a session uses the latest one in the shared store (saved on session.measure), dropping entries past their reset time.
 * Returns { list, at, own }.
 */
async function readRateLimits($, now) {
  const { rateLimits } = await $.session.usage()
  if (Array.isArray(rateLimits) && rateLimits.length > 0) return { list: rateLimits, at: now, own: true }
  const cached = await $.store.get(USAGE_KEY)
  const list = Array.isArray(cached?.rateLimits) ? cached.rateLimits : []
  return { list: list.filter((r) => !r.resetsAt || new Date(r.resetsAt).getTime() > now), at: cached?.at ?? now, own: false }
}

// ---------- Rendering (read-only) ----------

/** Wrap the Svg in a keyed Box (Svg itself takes no key) so tests and redraws can identify it. */
function svgBox(els, key, source, alt, size) {
  const { Box, Svg } = els
  // With a size the drawing keeps it: without one it is scaled down to whatever width its slot is squeezed to
  return size
    ? Box({ key, flexShrink: 0, children: [Svg({ source, alt, width: size.width, height: size.height })] })
    : Box({ key, children: [Svg({ source, alt })] })
}

/**
 * One timeline segment: a dot with connector lines above and below on the left (Svg on Desktop, characters and "│" in the terminal), a title plus one note line on the right.
 * Every segment is exactly ROWS.step rows tall, so the lines of adjacent segments meet.
 */
function timelineRow(els, isDesktop, item, i, columns) {
  const { Box, Text } = els
  const step = item.step
  const title = step ? step.title : item.text
  const note = step ? (item.kind === 'running' ? (step.note ?? t('inProgress')) : step.note) : undefined
  const noteColor = item.kind === 'bad' ? 'red' : item.kind === 'warn' ? 'yellow' : undefined
  const isMeta = !step // "N steps done" / "N more steps"
  let marker
  if (isDesktop && els.Svg) {
    // The node is as tall as the text beside it, so the connector still reaches the next node when a title wraps
    // Estimate the text's lines on the narrow side: a node taller than its text only adds space, one shorter leaves a gap in the line
    const cells = Math.max(8, (columns ?? 40) - STEP_RESERVED_CELLS - NODE_WRAP_MARGIN)
    const lines = wrapByWidth(title, cells).length + (note ? wrapByWidth(note, cells).length : 0)
    const height = nodeHeight(lines)
    marker = svgBox(els, 'node-' + i, svgTimelineNode(item.kind, item.label, item.top, item.bottom, height), title, { width: 28, height })
  } else {
    const icon = { done: '✓', collapsed: '✓', running: '●', warn: '!', bad: '!', todo: '○', more: '┆' }[item.kind] ?? '○'
    const color = { done: 'green', collapsed: 'green', running: 'cyan', warn: 'yellow', bad: 'red' }[item.kind]
    marker = Box({ flexDirection: 'column', children: [
      Text({ color, dimColor: !color, children: [icon] }),
      Text({ dimColor: true, children: [item.bottom ? '│' : ' '] }),
    ] })
  }
  const text = [Text({
    bold: item.kind === 'running',
    color: isMeta && item.kind === 'collapsed' ? 'green' : undefined,
    dimColor: item.kind === 'todo' || item.kind === 'more',
    wrap: 'wrap',
    children: [title],
  })]
  if (note) text.push(Text({ key: 'note-' + i, color: noteColor, dimColor: !noteColor, wrap: 'wrap', children: [note] }))
  return Box({ key: 'step-' + i, flexDirection: 'row', columnGap: 1, alignItems: 'center', children: [marker, Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: text })] })
}

/** With no reported steps, show a single line: task summary (the prompt condensed by AI) · elapsed time; no file names or tool actions. */
function activityRow(els, activity, now) {
  const elapsed = Math.floor(Math.max(0, now - activity.startedAt) / 60000)
  return els.Text({ key: 'activity', color: 'cyan', wrap: 'wrap', children: [(me.taskLabel ?? t('working')) + ' · ' + elapsed + 'm'] })
}

/** Background work is also a single line: the turn ended, but background commands or subagents are still running. */
function backgroundRow(els) {
  return els.Text({ key: 'background', color: 'cyan', wrap: 'wrap', children: [(me.taskLabel ?? t('working')) + ' · ' + t('background')] })
}

/** Current-session block: bold name (remaining time on the right) plus the latest 5 steps. maxRows is the number of rows available to this block. */
async function currentSection($, els, isDesktop, now, maxRows, columns) {
  const { Box, Text } = els
  const { progress, steps, source } = await currentSteps($)
  const title = me.title ?? folderName(me.cwd)
  const eta = steps.length === 0 ? '' : source === 'tool' ? etaText(estimateRemainingMin(progress, now)) : t('fromChecklist')
  const rows = [
    Box({
      flexDirection: 'row', justifyContent: 'space-between', columnGap: 1,
      children: [Text({ bold: true, wrap: 'wrap', children: [title] }), Text({ dimColor: true, children: [eta] })],
    }),
  ]
  if (progress?.task && maxRows >= 6) rows.push(Text({ dimColor: true, wrap: 'wrap', children: [progress.task] }))
  if (showActivity(me.activity, source === 'tool', now)) rows.push(activityRow(els, me.activity, now))
  else if (me.background && source !== 'tool') rows.push(backgroundRow(els))
  else if (steps.length === 0) rows.push(Text({ dimColor: true, children: [t('noSteps')] }))
  // Timeline: "N steps done" → latest 5 steps → "N more steps", all joined into one line
  const fit = fitSteps(steps, Math.max(0, maxRows - rows.length))
  timelineItems(fit).forEach((item, i) => rows.push(timelineRow(els, isDesktop, item, i, columns)))
  return rows
}

/** Section divider: a thick solid line with "other sessions" embedded in the middle (Svg on Desktop, ━ in the terminal). */
function sectionDivider(els, isDesktop, columns) {
  if (isDesktop && els.Svg) return svgBox(els, 'section-divider', svgSectionDivider(t('othersTitle')), t('othersTitle'))
  const side = '━'.repeat(Math.max(2, Math.floor(((columns ?? 40) - t('othersTitle').length - 4) / 2)))
  return els.Text({ key: 'section-divider', dimColor: true, wrap: 'truncate-end', children: [side + ' ' + t('othersTitle') + ' ' + side] })
}

/** How many cells fit on one line of an other-session name. */
const nameCells = (columns) => Math.max(8, (columns ?? 40) - NAME_RESERVED_CELLS)

/**
 * One row per other session (always 2 lines):
 * Line 1: ⊘ + light + name (click to jump) + time on the right; line 2 (Desktop): progress bar + faint divider. While working, only the bar is drawn, with no text.
 */
function otherRow($, els, isDesktop, s, now, columns) {
  const { Box, Button, Text } = els
  const stats = s.stats ?? { done: 0, total: 0, pct: 0 }
  const pct = stats.total > 0 ? stats.pct : null
  const status = statusOf(s)
  const url = jumpUrl(s.desktopId)
  const hide = Button({ key: 'hide-' + s.id, label: '✕', plain: true, dimColor: true, onPress: () => hideProject($, s.id) })
  if (isDesktop && els.Client && url && useClientRows($, now)) return clientRow(els, s, now, status, pct, url, hide)
  // Severe problems use a red triangle icon (⚠ in the terminal); other statuses use a light dot
  const dot = status === 'bad'
    ? (isDesktop && els.Svg ? svgBox(els, 'alert-' + s.id, svgAlertIcon(), t('severeAlt')) : Text({ key: 'light-' + s.id, color: 'red', children: ['⚠'] }))
    : Text({ key: 'light-' + s.id, color: LIGHT[status], children: [status === 'idle' ? '○' : '●'] })
  // Long names wrap: button labels do not wrap by themselves, so the name is split into stacked buttons and every line stays clickable
  const nameLines = wrapByWidth(s.name, nameCells(columns))
  const name = !url
    ? Text({ key: 'other-' + s.id, bold: true, wrap: 'wrap', children: [s.name] })
    : Box({ flexDirection: 'column', flexShrink: 1, children: nameLines.map((line, n) =>
        Button({ key: 'jump-' + s.id + (n === 0 ? '' : '-' + n), label: line, plain: true, onPress: () => jumpTo($, url, s.name) })) })
  const line1 = Box({
    flexDirection: 'row', justifyContent: 'space-between', columnGap: 1,
    children: [
      Box({ flexDirection: 'row', columnGap: 1, flexShrink: 1, alignItems: 'flex-start', children: [hide, dot, name] }),
      // The time column keeps its width and stays on one line; the name is what wraps
      Box({ flexShrink: 0, children: [timeLabel(els, s, url, [pct === null ? '' : pct + '%', rightTime(s, now)].filter(Boolean).join(' · '), () => jumpTo($, url, s.name))] }),
    ],
  })
  // The progress bar extends almost to the right edge (same width as the usage bars); the terminal uses a text bar sized to the pane width
  const line2 = isDesktop && els.Svg
    ? svgBox(els, 'line2-' + s.id, svgOtherLine(pct), pct === null ? s.name : s.name + ' ' + pct + '%')
    : Text({ key: 'line2-' + s.id, color: 'cyan', children: [pct === null ? ' ' : thinBar(pct, Math.max(8, (columns ?? 40) - 4))] })
  const info = hoverInfo(s)
  const infoText = info ? t(info.kind === 'stuck' ? 'hoverStuck' : info.kind === 'doing' ? 'hoverDoing' : 'hoverDone', info.text) : null
  // Drawn hidden and revealed while the pointer is anywhere on this session's block (the keyed row Box is the hover scope; this Box has no key, or it would be its own scope)
  const hoverLine = infoText ? Box({ display: 'none', hover: { display: 'flex' }, children: [Text({ dimColor: true, wrap: 'wrap', children: [infoText] })] }) : null
  // The keyed outer Box is the hover scope (pointer anywhere on this session); the inner Box fills it and takes the background
  return Box({ key: 'proj-' + s.id, flexDirection: 'column', children: [
    Box({ flexDirection: 'column', hover: { backgroundColor: HOVER_BG }, children: [line1, line2, hoverLine].filter(Boolean) }),
  ] })
}

/** Desktop: the whole block (name, bar, time) is one Client region (hooks/row.js), so a click anywhere on it jumps and the hover background is one piece. ✕ stays outside so untracking never jumps. */
function clientRow(els, s, now, status, pct, url, hide) {
  const { Box, Client } = els
  rowTargets.set(s.id, { url, name: s.name })
  return Box({ key: 'proj-' + s.id, flexDirection: 'row', columnGap: 1, alignItems: 'flex-start', children: [
    hide,
    // The region takes the room left beside ✕ and never more: sized by its content it pushed the whole pane wider than the window
    Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden', children: [Client({ key: 'jump-' + s.id, module: './row.js', width: '100%', props: {
      name: s.name,
      glyph: status === 'bad' ? '▲' : status === 'idle' ? '○' : '●',
      light: LIGHT[status],
      right: [pct === null ? '' : pct + '%', rightTime(s, now)].filter(Boolean).join(' · '),
      pct,
      barColor: COLORS.running,
      track: COLORS.track,
      hoverBg: HOVER_BG,
      jumpingLabel: t('jumping'),
    } })] }),
  ] })
}

/** Whether the Client regions work in this pane; module state, reset on each load. */
const clientProbe = { supported: true, ready: false, failed: false, firstDrawAt: null }

function useClientRows($, now) {
  if (!clientRowMode(clientProbe, now, CLIENT_GRACE_MS)) return false
  if (clientProbe.firstDrawAt === null && !clientProbe.ready) {
    clientProbe.firstDrawAt = now
    // Draw again once the grace is over, so a region that never started is replaced by plain rows without waiting for other changes
    $.clock.after(CLIENT_GRACE_MS + 100, () => { if (!clientProbe.ready) $.ui.invalidate('ui.render') })
  }
  return true
}

/** Where each drawn block jumps to, filled while drawing; a click only sends the block's key, so the link never comes from the click itself. */
const rowTargets = new Map()

/** A click on a session block (hooks/row.js): log it, then jump. */
async function onRowMessage($, e) {
  const id = String(e.element).replace(/^jump-/, '')
  const target = rowTargets.get(id)
  if (!target || !e.data || e.data.jump !== true) return
  try {
    const log = (await $.store.get(CLICK_LOG_KEY)) ?? []
    await $.store.set(CLICK_LOG_KEY, [...log, { at: await $.clock.now(), id, name: target.name }].slice(-CLICK_LOG_MAX))
  } catch {}
  await jumpTo($, target.url, target.name)
}

/** The time on the right of a row: a button too when the session can be jumped to, so the whole row is clickable. */
function timeLabel(els, s, url, text, onPress) {
  if (!url || !text) return els.Text({ dimColor: true, wrap: 'truncate-end', children: [text] })
  return els.Button({ key: 'jump-' + s.id + '-time', label: text, plain: true, dimColor: true, onPress })
}

/** Group header above sessions that share a name before "-". */
function groupHeader(els, item) {
  return els.Box({ key: 'group-' + item.key, children: [els.Text({ dimColor: true, wrap: 'truncate-end', children: ['▾ ' + t('groupLabel', item.name, item.count)] })] })
}

/**
 * Usage (pinned to the bottom of the pane): Session limit / Weekly limit, "used% · resets in 2h", 4px bar; a stale reading from another session is labelled with its reading time.
 * compact = when the pane is very short, each limit takes 1 line (text only, colour shows the level) so there is still room above.
 */
async function usageSection($, els, isDesktop, now, compact = false) {
  const { Box, Text } = els
  const reading = await readRateLimits($, now)
  const segments = usageSegments(reading.list, now)
  if (segments.length === 0) return [Text({ dimColor: true, children: [t('usageEmpty')] })]
  const staleTag = !reading.own && now - reading.at > USAGE_STALE_MS ? ' · read ' + ago(reading.at, now) : ''
  return segments.map((seg, i) => {
    const fill = limitColor(seg.pct)
    const termColor = fill === COLORS.bad ? 'red' : fill === COLORS.warn ? 'yellow' : 'cyan'
    if (compact) {
      return Box({ key: 'limit-compact-' + seg.label, flexDirection: 'row', justifyContent: 'space-between', children: [
        Text({ children: [seg.label] }),
        Text({ color: isDesktop ? fill : termColor, children: [seg.pct + '%' + (seg.reset ? ' · ' + seg.reset : '') + (i === 0 ? staleTag : '')] }),
      ] })
    }
    return Box({
      key: 'limit-' + seg.label, flexDirection: 'column',
      children: [
        Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
          Text({ children: [seg.label] }),
          Text({ dimColor: true, children: [seg.pct + '%' + (seg.reset ? ' · ' + seg.reset : '') + (i === 0 ? staleTag : '')] }),
        ] }),
        isDesktop && els.Svg
          ? svgBox(els, 'limit-bar-' + seg.label, svgThinBar(seg.pct, fill), seg.label + ' ' + seg.pct + '%')
          : Text({ color: termColor, children: [thinBar(seg.pct)] }),
      ],
    })
  })
}

// ---------- Events ----------

const toolSpec = () => ({
  name: 'progress',
  description: t('toolDescription'),
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: t('toolTask') },
      steps: {
        type: 'array',
        maxItems: 5,
        description: t('toolSteps'),
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: t('toolStepTitle') },
            status: { type: 'string', enum: ['done', 'running', 'warn', 'bad', 'todo'] },
            note: { type: 'string', description: t('toolStepNote') },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['steps'],
  },
})

export function register(on) {
  // Open the pane first and push slow work such as the name lookup to the background (looking up the name first blocked session.start for about 1 s)
  on('session.start', async ($, e, next) => {
    // UI language: env var SESSION_DASHBOARD_LANG (default English; zh-TW for Traditional Chinese). The name must be a literal.
    setLang(await $.env.get('SESSION_DASHBOARD_LANG').catch(() => undefined))
    me.id = await $.session.id()
    me.cwd = await $.session.cwd()
    me.isWorking = false
    me.titleCheckedAt = 0
    me.firstSeen = me.firstSeen ?? (await $.clock.now())
    me.ownsChecklist = !!(await $.store.get(OWNS_PREFIX + me.id))
    if (AUTO_OPEN) await openPane($, false)
    me.timers = [
      // Registering the tool waits until it is actually usable (measured at about 0.9 s), so it also runs in the background and does not block session start
      $.clock.after(0, async () => {
        await $.command.register({ name: 'dashboard', description: t('commandDescription'), immediate: true })
        await $.tool.register(toolSpec())
      }),
      $.clock.after(0, () => heartbeat($)),
      $.clock.every(HEARTBEAT_MS, () => heartbeat($)),
      $.clock.after(0, () => redrawIfChanged($)),
      $.clock.every(CHANGE_CHECK_MS, () => redrawIfChanged($)),
      $.clock.every(TIME_REDRAW_MS, () => $.ui.invalidate('ui.render')),
      $.clock.every(FOCUS_REFRESH_MS, async () => {
        if (await refreshFocus($)) await publish($)
      }),
    ]
    return next(e)
  })

  // The Desktop view attaches later than session.start, and a pane opened before that is not shown, so open it again on attach
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (AUTO_OPEN) await openPane($, false)
    return result
  })

  // After /clear, /resume or /branch (session.start does not fire again): re-register under the new id
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const result = await next(e)
    await adoptSessionId($)
    await heartbeat($)
    $.ui.invalidate('ui.render')
    return result
  })

  // Record every tool action (except the progress tool itself); observe only, never block; write to the store at most once per ACTIVITY_PUBLISH_MS
  on('tool.call', async ($, e, next) => {
    if (!me.ownsChecklist && touchesChecklist(e)) {
      me.ownsChecklist = true
      if (me.id) await $.store.set(OWNS_PREFIX + me.id, { at: await $.clock.now() })
      $.ui.invalidate('ui.render')
    }
    if (me.activity && e.tool !== PROGRESS_TOOL) {
      const now = await $.clock.now()
      me.activity = { ...me.activity, actions: pushAction(me.activity.actions, actionLabel(e), now) }
      if (now - me.activityPublishedAt >= ACTIVITY_PUBLISH_MS) {
        me.activityPublishedAt = now
        await publish($)
      }
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Claude reports step progress
  on('tool.call', { tool: PROGRESS_TOOL }, async ($, e) => {
    const progress = await saveProgress($, () => ({ task: e.task, steps: e.steps }))
    const stats = stepStats(progress.steps)
    return { result: progress.steps.length === 0 ? t('progressCleared') : t('progressUpdated', stats.done, stats.total) }
  })

  // The built-in todo list is mirrored into the pane on every update; only the warn/bad marks still come from the progress tool
  on('tool.call', { tool: TODO_TOOL }, async ($, e, next) => {
    // Mirroring is best effort: a store failure must never block the todo tool itself
    if (me.id && Array.isArray(e.todos)) { try { await saveProgress($, (prev) => todosToInput(e.todos, prev?.steps)) } catch {} }
    return next(e)
  })

  // Read the background task list when a turn ends: Claude ends the turn after pushing work to the background, which must not count as idle (official docs: tell "done" apart from "waiting on background work")
  on('classic.Stop', async ($, e, next) => {
    me.background = summarizeBackground(e.background_tasks)
    if (me.background) me.finishedAt = null
    else if (!me.isWorking && me.finishedAt === null) await markFinished($)
    await publish($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setWorking($, true)
    await publish($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setWorking($, false)
    if (!me.background) await markFinished($)
    await publish($)
    $.ui.invalidate('ui.render')
    $.clock.after(0, () => maybeRename($)) // Runs in the background so it does not delay the end of the turn
    return next(e)
  })

  // Fallback when the rename tool cannot be called: attach sessionTitle on the next submitted prompt
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    me.taskLabel = null
    if (typeof e.prompt === 'string' && e.prompt.trim() !== '') $.clock.after(0, () => summarizeTask($, e.prompt))
    if (!me.pendingTitle) return result
    const sessionTitle = me.pendingTitle
    me.pendingTitle = null
    return { ...result, sessionTitle }
  })

  // When usage changes, save a copy for new sessions that have no reading yet (account-wide)
  on('session.measure', async ($, e, next) => {
    if (Array.isArray(e.rateLimits) && e.rateLimits.length > 0) {
      await $.store.set(USAGE_KEY, { rateLimits: e.rateLimits, at: await $.clock.now() })
    }
    // No immediate redraw: usage is refreshed together with the per-minute redraw (by design)
    return next(e)
  })

  // End: delete own data. On /clear and /resume the process keeps running, so stop publishing under the old id and wait for classic.SessionStart to adopt the new one;
  // on a real exit, cancel the timers
  on('session.end', async ($, e, next) => {
    if (me.id) {
      await $.store.delete(KEY_PREFIX + me.id)
      await $.store.delete(PROGRESS_PREFIX + me.id)
      await $.store.delete(OWNS_PREFIX + me.id)
    }
    me.id = ''
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      for (const t of me.timers) t?.cancel?.()
      me.timers = []
    }
    return next(e)
  })

  // A block whose region failed (did not load, stopped answering): the engine would draw its long error line in its place; draw plain rows instead for the rest of this session
  on('ui.fault', async ($, e, next) => {
    if (String(e.module ?? '').endsWith('row.js')) {
      clientProbe.failed = true
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (e.module !== './row.js' && !String(e.module).endsWith('row.js')) return next(e)
    if (e.data && e.data.ready === true) { clientProbe.ready = true; return {} }
    await onRowMessage($, e)
    return {}
  })

  // The terminal uses /dashboard; Desktop's / menu does not list mod commands, so the button above the prompt is used instead
  on('command.run', { command: 'dashboard' }, async ($) => {
    await openPane($, true)
    return {}
  })

  // Above the prompt: only the open-pane button; whatever later mods (e.g. next-steps) render goes below it
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    // The button is an explicit action, so the pane opens at any width and on Desktop
    const open = Button({ key: 'open-sessions', label: PANE_BUTTON_LABEL, plain: true, dimColor: true, onPress: () => openPane($, true) })
    const button = open // An untracked session comes back when the user opens it, so no "show hidden" button is needed
    return below ? Box({ flexDirection: 'column', children: [button, below] }) : button
  })

  // Sessions pane (single page): compute available rows → usage (pinned to the bottom) → other sessions get their guaranteed rows → the rest goes to the current session's latest 5 steps
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    const els = $.ui.resolve(e)
    rowTargets.clear() // only the blocks drawn this time can be clicked
    const { Box, Text } = els
    const isDesktop = e.surface !== 'terminal'
    const now = await $.clock.now()
    const budget = e.props.scroll?.bodyRows || FALLBACK_BUDGET
    let usageList = await usageSection($, els, isDesktop, now)
    const usageCount = usageList.length === 1 && usageList[0].type === 'Text' ? 0 : usageList.length
    // When the pane is very short (after the full usage block, not even name + 1 step fits), switch to compact usage: 1 line per limit
    const compact = usageCount > 0 && budget - usageRows(usageCount) - 1 < 1 + ROWS.step
    if (compact) usageList = await usageSection($, els, isDesktop, now, true)
    const usageUsed = compact ? usageCount : usageRows(usageCount)
    const contentRows = Math.max(1, budget - usageUsed - 1)
    const { visible: unsorted } = splitHidden(await loadOthers($, now), await loadHidden($))
    const visible = sortByUrgency(unsorted)
    const items = groupSessions(visible)
    const headerRows = items.filter((item) => item.type === 'header').length
    // All other sessions are listed (no limit, by design); the current session keeps at least name + 1 step, and the pane becomes scrollable if that does not fit
    const currentMin = 1 + ROWS.step
    const shown = visible.length
    const wrapExtra = visible.reduce((n, s) => n + wrapByWidth(s.name, nameCells(e.props.bodyColumns)).length - 1, 0)
    const othersNeed = othersRows(shown, shown) + wrapExtra + headerRows
    const overflow = contentRows - othersNeed < currentMin
    // SECTION_GAP blank lines between the current session and "other sessions"; this gap shrinks first when space is tight
    const gap = shown > 0 ? Math.max(0, Math.min(SECTION_GAP, contentRows - othersNeed - currentMin)) : 0
    const current = await currentSection($, els, isDesktop, now, overflow ? currentMin : contentRows - othersNeed - gap, e.props.bodyColumns)
    const children = [Box({ flexDirection: 'column', children: current })]
    if (shown > 0) {
      for (let g = 0; g < gap; g++) children.push(Text({ key: 'section-gap-' + g, children: [' '] }))
      const rows = []
      let first = true
      for (const item of items) {
        if (item.type === 'header') {
          rows.push(groupHeader(els, item))
          first = true // no divider right under a header
          continue
        }
        const s = item.s
        // 1 blank line between sessions, with a faint thin line drawn inside it
        if (!first) rows.push(isDesktop && els.Svg ? svgBox(els, 'gap-' + s.id, svgSessionGap(), '') : Text({ key: 'gap-' + s.id, children: [' '] }))
        first = false
        rows.push(otherRow($, els, isDesktop, s, now, e.props.bodyColumns))
      }
      children.push(sectionDivider(els, isDesktop, e.props.bodyColumns), Box({ flexDirection: 'column', children: rows }))
    }
    // When it does not fit, do not fix the height or clip; let the pane show its own scrollbar
    const content = overflow
      ? Box({ key: 'content', flexDirection: 'column', flexShrink: 0, children })
      : Box({ key: 'content', flexDirection: 'column', flexGrow: 1, flexShrink: 1, children })
    const usage = Box({ key: 'usage', flexDirection: 'column', flexShrink: 0, rowGap: compact ? 0 : 1, children: usageList })
    // Fill the available height with usage at the bottom; overflow:hidden is only a last resort, the content never exceeds it anyway
    return overflow
      ? Box({ flexDirection: 'column', rowGap: 1, children: [content, usage] })
      : Box({ flexDirection: 'column', rowGap: 1, height: budget, children: [content, usage] })
  })
}
