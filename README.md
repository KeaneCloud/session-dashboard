# session-dashboard

A [Claude Code](https://claude.com/claude-code) mod that adds a **Sessions pane**: one place to see what every open session is doing, how far along it is, which ones are waiting for you, and how much of your 5-hour and weekly usage is left.

## What it does

- **Current session** – a timeline of the task's steps (up to 5, centred on the one in progress). When Claude has not reported any steps, it shows a single line: what the task is and how many minutes it has been running.
- **Other sessions** – one block each, with a status light, name, progress bar (as long as the "Other sessions" divider) and time. The whole block lights up under the pointer and shows one more line (what it is doing, what it needs from you, or what it finished); click the name or the time to jump to that session. Sessions that need you come first, then finished-but-unseen, working, and seen. Sessions whose names share the part before `-` (for example `Admin site` and `Admin site-login`) are grouped under one header.
- **Usage** – the session (5-hour) limit and weekly limit, pinned to the bottom of the pane and refreshed once a minute.
- **Auto-naming** – after 2 turns, a small model reads the whole conversation and names the session after the thing being worked on: a noun only, 6 words or fewer (a CJK character counts as one word). A name another session already uses gets a `-purpose` suffix. Sessions started by the desktop app's project system get `-` and the first 2 characters of their folder name appended, so you can tell which project they belong to. Sessions you renamed yourself are left alone.
- **✕ Untrack** – press it and the session disappears from the pane. It comes back when you open that session again.

### Status lights

| Light | Meaning |
|---|---|
| Blue dot | Working (including background work that is still running) |
| Orange dot | Finished, and you have not looked at it yet |
| Hollow dot | You have seen it |
| Red dot | There is a problem you need to handle |
| Red triangle | A severe problem; the work may have stopped |

## Requirements

- Claude Code **2.1.286 or later** (for the desktop app, a build that bundles that version or later).
- Developed and used on the **Claude desktop app for Windows**. Two features rely on Windows-only paths and commands and do nothing elsewhere:
  - reading a session's name and "last viewed" time from `%APPDATA%\Claude\claude-code-sessions\`;
  - jumping to another session (opens a `claude://` link through `rundll32.exe`).
- It also loads in the terminal, where the pane is drawn with text. Jumping between sessions and the "finished, not seen yet" light are not available there.

## Install

1. Clone the repository:

   ```bash
   git clone https://github.com/KeaneCloud/session-dashboard.git
   ```

2. Add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (separate several mods with `;`):

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\session-dashboard"
     }
   }
   ```

3. **Quit the Claude desktop app completely and open it again.** A mod is loaded only when a session's process starts.

To try it once in a terminal instead:

```bash
claude --plugin-dir /path/to/session-dashboard
```

The pane opens automatically with each session. If you close it, press **☰ Sessions** above the prompt to open it again.

## Language

The pane is in English by default. For Traditional Chinese, set an environment variable in `~/.claude/settings.json`:

```json
{
  "env": {
    "SESSION_DASHBOARD_LANG": "zh-TW"
  }
}
```

All strings live in [`hooks/i18n.js`](hooks/i18n.js); to add a language, add a block there with the same keys.

## Getting Claude to report steps

The mod registers a tool, `mcp__session-dashboard__progress`. When Claude calls it, the step timeline appears in the pane. To make that a habit, add something like this to your `~/.claude/CLAUDE.md`:

```markdown
- **Sessions pane**: when the `mcp__session-dashboard__progress` tool is available (use ToolSearch
  if it is not loaded), call it when a task starts, when a step finishes, when you are blocked and
  waiting for me, and when the task is done. Pass the full step list every time, at most 5 steps,
  a few words per step. status: done / running / warn (a problem I need to handle) / bad (a severe
  problem) / todo. Pass an empty list when the task is over.
```

When Claude has not called the tool, the pane falls back to the checkboxes in `checklist.md` (or `TASKS.md`) in the working folder, but only once that session has written to the file itself. A checklist left there by another session is ignored:

```markdown
- [x] A finished step
- [ ] A step still to do
- [ ] A blocked step BLOCKED: what you need from the user
- [ ] A broken step CRITICAL: what went wrong
```

## What costs usage

Two features call a small model (Haiku), each for a few tokens:

- auto-naming – once per session (twice if the first name comes back too long);
- the task summary line – once for each message you send.

To turn auto-naming off, set `AUTO_RENAME` to `false` at the top of `hooks/register.js`.

## Settings

Tunable values are constants at the top of `hooks/register.js` and `hooks/lib.js`. Restart the app after changing them.

| Constant | Default | Meaning |
|---|---|---|
| `AUTO_OPEN` | `true` | Open the pane when a session starts |
| `AUTO_RENAME` | `true` | Name sessions automatically |
| `RENAME_AFTER_TURNS` | `2` | Turn after which a session is named |
| `TITLE_MAX` | `6` | Longest session name, in words (plus up to `SUFFIX_MAX` for a `-purpose` suffix) |
| `TASK_LABEL_MAX` | `12` | Longest task summary, in words |
| `TIME_REDRAW_MS` | 60 s | How often times and usage are refreshed |
| `CHANGE_CHECK_MS` | 10 s | How often other sessions are checked for changes |
| `LIGHT` (`lib.js`) | – | Status light colours |

## What it reads, writes and sends

- **Shared store** (`$.store`, kept on your machine by Claude Code): each session's name, status and step progress, plus the latest usage reading. This is how the panes of different sessions see each other.
- **Files it reads**: the desktop app's session records, and `checklist.md` / `TASKS.md` in the working folder.
- **What goes to the model**: for auto-naming, what you said in that session and the first line of each of Claude's replies (both trimmed); for the task summary, the message you just sent. Nothing else leaves your machine.
- The pane shows step names and summaries only, never full file paths or command text.

## Development

```bash
claude plugin validate .
claude plugin test .
```

Tests are in `tests/` and use the `claude-code/testing` kit that ships with Claude Code. `.claude-plugin/types/` is generated by Claude Code and is not checked in.

## License

[MIT](LICENSE)
