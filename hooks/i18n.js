// UI strings. English is the default; set the env var SESSION_DASHBOARD_LANG=zh-TW
// (for example in the "env" block of ~/.claude/settings.json) for Traditional Chinese.
// To add a language, add a block below with the same keys.

export const DEFAULT_LANG = 'en'

export const STRINGS = {
  en: {
    othersTitle: 'Other sessions',
    queuedHint: 'Not enough room for the pane. Press ☰ Sessions above the prompt to open it',
    paneOpenFailed: (err) => 'Could not open the Sessions pane: ' + err,
    jumpFailed: (name, err) => 'Could not jump to "' + name + '": ' + err,
    working: 'Working',
    background: 'background',
    inProgress: 'In progress…',
    noSteps: 'No steps in progress',
    fromChecklist: 'from checklist',
    usageEmpty: 'Usage: no data yet',
    severeAlt: 'Severe problem',
    hoverStuck: (text) => 'Needs you: ' + text,
    hoverDoing: (text) => 'Doing: ' + text,
    hoverDone: (text) => 'Done: ' + text,
    groupLabel: (name, n) => name + ' (' + n + ')',
    doneCollapsed: (n) => n + ' done',
    moreSteps: (n) => n + ' more',
    commandDescription: 'Open the Sessions pane',
    progressCleared: 'Cleared the steps on the pane',
    progressUpdated: (done, total) => 'Pane updated: ' + done + '/' + total + ' done',
    actEdit: (file) => 'Edit ' + file,
    actRead: (file) => 'Read ' + file,
    actRun: (d) => (d ? 'Run: ' + d : 'Run a command'),
    actSearch: 'Search the code',
    actWeb: 'Look something up online',
    actAgent: (d) => (d ? 'Subagent: ' + d : 'Start a subagent'),
    actTool: (tool) => 'Use ' + tool,
    bgShell: 'Background command',
    bgSubagent: 'Subagent',
    bgMonitor: 'Monitor',
    bgWorkflow: 'Workflow',
    bgOther: 'Background work',
    digestUser: 'User: ',
    digestClaude: 'Claude: ',
    renameTask: 'Name this conversation after the thing being worked on, in the language the user writes in: only the noun that best represents it (e.g. "Login page", "API docs"), no verbs and no adjectives',
    existingNames: (names) => '\nOther sessions are named: ' + names.join(', ') + '. If this conversation is about the same thing as one of them (e.g. split off from it), name it "<that name>-<purpose>", the purpose also a noun only, e.g. "Admin site-login".',
    duplicateName: (name) => 'The name "' + name + '" is already used by another session. Reply with "' + name + '-<purpose>" instead, the purpose a noun only.',
    summaryTask: 'Condense the user request into a short phrase that says what to do, in the language the user writes in',
    nameRule: (max) => '. At most ' + max + ' words (one English word counts as 1, one CJK character counts as 1). It must be a complete phrase, never cut off mid-way, and as short as possible. Reply with the name only: no quotes, no punctuation, no explanation.',
    shortenTask: 'Rewrite this name to be shorter',
    tooLong: (name, units) => 'The name "' + name + '" is ' + units + ' words, which is too long.',
    toolDescription:
      'Report the step-by-step progress of the current task to the Sessions pane. Call it when a multi-step task starts, when a step finishes, when you are blocked, and when the task is done; pass the full step list every time. ' +
      'Split a task into at most 5 steps and keep each title to a few words (for example "Rework usage bar"), with no detail; a note is one sentence. ' +
      'status: done, running, warn (a problem the user must handle), bad (a severe problem that may stop the work), todo. For warn and bad, the note says in one sentence what the user needs to do. ' +
      'Passing an empty steps list clears the pane.',
    toolTask: 'One-line name for the whole task (optional, a few words)',
    toolSteps: 'At most 5 steps',
    toolStepTitle: 'Step name, a few words',
    toolStepNote: 'For warn/bad: one sentence on the problem and what the user needs to do',
  },
  'zh-TW': {
    othersTitle: '其他 session',
    queuedHint: '面板空間不夠，點輸入框上方的 ☰ Sessions 打開',
    paneOpenFailed: (err) => 'Sessions 面板開不起來：' + err,
    jumpFailed: (name, err) => '跳不到「' + name + '」：' + err,
    working: '工作中',
    background: '背景',
    inProgress: '進行中…',
    noSteps: '目前沒有進行中的步驟',
    fromChecklist: '依清單',
    usageEmpty: '用量：尚無資料',
    severeAlt: '嚴重問題',
    hoverStuck: (text) => '要你處理：' + text,
    hoverDoing: (text) => '正在：' + text,
    hoverDone: (text) => '做完：' + text,
    groupLabel: (name, n) => name + '（' + n + '）',
    doneCollapsed: (n) => '已完成 ' + n + ' 步',
    moreSteps: (n) => '還有 ' + n + ' 步',
    commandDescription: '打開 Sessions 面板',
    progressCleared: '已清除面板上的步驟',
    progressUpdated: (done, total) => '已更新面板：' + done + '/' + total + ' 完成',
    actEdit: (file) => '修改 ' + file,
    actRead: (file) => '讀取 ' + file,
    actRun: (d) => (d ? '執行指令：' + d : '執行指令'),
    actSearch: '搜尋程式碼',
    actWeb: '查網路資料',
    actAgent: (d) => (d ? '派子代理：' + d : '派子代理'),
    actTool: (tool) => '使用 ' + tool,
    bgShell: '背景指令',
    bgSubagent: '子代理',
    bgMonitor: '監看',
    bgWorkflow: '工作流程',
    bgOther: '背景工作',
    digestUser: '使用者：',
    digestClaude: 'Claude：',
    renameTask: '你替對話取一個繁體中文名稱：只寫在做的那個東西，用最能代表它的名詞（例：登入頁、API文件），不要動詞、不要形容詞',
    existingNames: (names) => '\n其他 session 的名字：' + names.join('、') + '。如果這個對話跟其中一個是同一件事（例如從它分出來的），取名為「那個名字-用途」，用途也只用名詞，例：網站後台-登入。',
    duplicateName: (name) => '「' + name + '」已經有別的 session 用了，請改成「' + name + '-用途」，用途只用名詞。只回名稱本身。',
    summaryTask: '把使用者的請求濃縮成繁體中文，說出要做什麼即可',
    nameRule: (max) => '，' + max + ' 個字以內（英文一個單字算 1 個字）。要完整、不要寫到一半，能短就短。只回名稱本身，不要引號、標點或解釋。',
    shortenTask: '把名稱改寫得更短',
    tooLong: (name, units) => '原本的名稱「' + name + '」有 ' + units + ' 個字，太長了。',
    toolDescription:
      '把目前任務的步驟進度回報到使用者的 Sessions 面板。多步驟任務開始時、每完成一步、卡住時、整件做完時呼叫；每次都傳完整的步驟清單。' +
      '一個任務最多拆成 5 步，抓大方向就好；步驟名稱約 12 字以內、講大概即可（例如「改用量顯示」），不要寫細節；note 只寫一句話。' +
      'status：done 完成、running 進行中、warn 有問題需要使用者處理、bad 嚴重問題可能停住（兩者的 note 都用一句話說明要使用者做什麼）、todo 還沒開始。' +
      '傳空的 steps 會清掉面板上的步驟。',
    toolTask: '整個任務的一句話名稱（選填，約 15 字以內）',
    toolSteps: '最多 5 步',
    toolStepTitle: '步驟名稱，約 12 字以內、講大概即可',
    toolStepNote: 'warn/bad 時一句話說明問題與需要使用者做什麼',
  },
}

let current = DEFAULT_LANG

/** Pick the language from a locale-like code ("zh-TW", "zh_TW.UTF-8", "en"); unknown codes fall back to English. */
export function setLang(code) {
  const c = String(code ?? '').toLowerCase()
  current = c.startsWith('zh') ? 'zh-TW' : DEFAULT_LANG
  return current
}

/** Look up a UI string in the current language; function entries take arguments. */
export function t(key, ...args) {
  const entry = STRINGS[current][key] ?? STRINGS[DEFAULT_LANG][key]
  return typeof entry === 'function' ? entry(...args) : entry
}
