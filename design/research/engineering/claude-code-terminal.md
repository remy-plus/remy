# Claude Code's terminal UI: what the installed build shows

Method: Claude Code 2.1.312 (arm64 Mach-O built with Bun) holds its JavaScript bundle as readable text. I ran `grep -a -o` with tight patterns against the binary and wrote nothing to disk (the scratch folder was empty and has been deleted). Quotes below are a few lines each, from minified code; names like `Mh` or `zEs` are minifier output and will change between versions. This extends `claude-code.md` (public statements only) and does not repeat it. Accessed 2026-10-28. "V" = seen in the 2.1.312 bundle, "P" = public doc or earlier study, "?" = not determined.

## 1. Rendering

- **Custom Ink-derived renderer (V).** The root node is still called `ink-root` (`this.rootNode=go("ink-root",...)`) and the class has `focusManager`, Yoga layout counters (`lastYogaCounters={ms,visited,measured,cacheHits,live}`), `frontFrame`/back frame, and `scheduleRender`. So it is a fork or rewrite of Ink's shape, not stock Ink. It diffs frames and owns cursor and modes.
- **Terminal modes are tracked by one object (V).** `this.modes.reassert("bracketedPaste" | "extendedKeys" | "mouse" | "mousePixels" | "altScreen")`, plus `reassertFrom("altScreen")` and `reenterAltScreen()`. After a suspend (Ctrl+Z, fg) or a tmux reattach it rewrites every mode in one write and resets the frames for the alt screen. A parser watches `ESC[?1000/1002/1003/1004/1006/2004/2031 h|l` so it knows which modes the app, not the terminal, turned on.
- **Synchronized output (DEC 2026) is auto-detected, not assumed (V).** A decision function: tmux answers for itself (`if(i.TMUX) return {likely:false}`), `CLAUDE_CODE_FORCE_SYNC_OUTPUT` forces it, JetBrains is special-cased, otherwise a cached terminal-capability probe (`synchronizedOutput` state `settled` or `likely`). The result is reported in session telemetry as `syncOutput`. Frames are wrapped in `ESC[?2026h ... ESC[?2026l`.
- **Alternate screen is the default, with opt-outs (V).** Env vars: `CLAUDE_CODE_NO_FLICKER` (on/off), `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, `CLAUDE_CODE_DISABLE_MOUSE`, `CLAUDE_CODE_SCROLL_SPEED`, and a `/tui fullscreen` command. There is a sticky auto-disable "after repeated failed starts" (string: `recorded sticky auto-disable, honoured at REPL mount`) and a `win_ssh_auto_off` reason. Mouse is SGR (1006). Scroll box exists (`JP` with `stickyScroll` prop).
- **Frame pacing is adaptive (V).** `scheduleFrame()`:

  ```
  let n=this.pacerNow(), u=n-this.lastPacedFrameAt,
      f=n<this.inputPriorityUntil ? zEs : Mh;
  if(u>=f){this.queuePacedFrame();return}
  ... setTimeout(() => this.queuePacedFrame(), max(0, lastPacedFrameAt+f-n))
  ```

  Constants in the bundle: `zEs=4` (ms between frames right after a keypress), `GEs=50` (ms the input-priority window lasts, set as `inputPriorityUntil=pacerNow()+GEs`), `VEs=16384`. The normal interval `Mh` is a minified name I could not resolve to one value; the engineer's public figure is about 16 ms (P). Meaning: typing gets a 4 ms path for 50 ms after each key, while streamed tokens render at the slower base rate.
- **Backpressure (V).** `queuePacedFrame()` checks `nonBlockingStdout.queuedBytes() > VEs` (16 KiB); if the pipe is backed up it sets `frameHeldForBacklog` and retries after a short timer instead of writing another frame. Output goes through a `nonBlockingStdout` wrapper with `flush()` on exit. This is what stops slow SSH links from lagging behind the stream.
- **Streaming path (V).** The API layer has a "headless plain delta fast path" for `text_delta` and `input_json_delta`, and flags like `api_stream_delta_merge` and `api_stream_text_delivery` (feature gates, behaviour not visible). Deltas are merged before reaching React; I found no per-token render.
- **Static regions:** not used in fullscreen (the whole tree is the screen, only visible messages kept, per docs P). Classic mode keeps native scrollback (P).

## 2. Input

- **Keybinding table is data (V).** Contexts: `Global`, `Chat`, `Autocomplete`, `Settings`, `Confirmation`, `Select`, `DiffPanel`. Defaults in the bundle:
  - `Global`: `ctrl+c` app:interrupt, `ctrl+d` app:exit, `ctrl+o` toggleTranscript, `ctrl+t` toggleTodos, `ctrl+r` history:search.
  - `Chat`: `escape` chat:cancel, `enter` chat:submit, `ctrl+j` chat:newline, `up`/`down` history, `ctrl+l` clearInput, `ctrl+_` undo, `ctrl+g` or `ctrl+x ctrl+e` external editor, `ctrl+s` stash, `ctrl+v` imagePaste, `ctrl+x enter` queueSubmit, `ctrl+enter` or `ctrl+x ctrl+s` sendNow, `meta+p` model picker, `meta+t` thinking toggle, `shift+up/down` effort, `ctrl+x ctrl+k` kill agents.
  - `Autocomplete`: `tab` accept, `escape` dismiss, up/down.
  - Chords are supported (`"ctrl+x ctrl+k"`), user file is `~/.claude/keybindings.json` (a built-in skill edits it), and null unbinds (`"ctrl+s":null`).
- **Newline paths (V).** `ctrl+j` always; `\` then Enter (tracked in config as `hasUsedBackslashReturn`); Shift+Enter via `shiftEnterKeyBindingInstalled`, written by a terminal-setup step (iTerm2 detected by `__CFBundleIdentifier`).
- **Bracketed paste (V).** Mode 2004 is reasserted with the other modes. Large pastes become `[Pasted text #N +M lines]` and `[...Truncated text #N +M lines]` placeholders; a `paste-cache` directory with a 10 MB retention cap (`km=1e7`) and in-flight/failed-write maps stores the real text so recall resends it. Images paste as `[Image #N]`.
- **History (V).** Up/down history, `ctrl+r` search, `ctrl+s` stash (hint shown once: `"Tip: ctrl+s stash"`, gated on `hasUsedStash`).
- **Vim mode (V).** `editorMode` setting, `vimMode==="NORMAL"` changes cursor placement on history recall (cursor lands at start of line in normal mode, end otherwise).
- **Interrupt (V).** `Esc` is bound to `chat:cancel` (stop the turn, restore the draft), `Ctrl+C` to `app:interrupt`, `Ctrl+D` to `app:exit`; both quit keys use a pending state ("press again", `keyName` shown in the hint) keyed by the resolved binding name, so remapping updates the hint text.
- **Queueing while running (V).** `queued_command` inputs, `ctrl+x enter` queues, `ctrl+enter` "sends now" (interrupts and sends); footer strings "esc to interrupt" and "esc to interrupt and send". Queued items wait behind a permission prompt (`waits_behind_permission_prompt`) and are folded in before one (`taken_in_before_permission_prompt`).

## 3. Layout during a turn

- **Spinner verbs (V).** A list `b=["Accomplishing","Actioning","Actualizing","Architecting","Baking","Beaming","Beboppin'","Befuddling",...,"Brewing","Clauding","Cogitating",...]`; users can `append` or `replace` via `spinnerVerbs` setting. Spinner row shows verb, elapsed time and tokens, with an "esc to interrupt" hint; tips can show under it (`spinnerTipsEnabled`, `spinnerTipsOverride`). Shimmer colors per theme token (P).
- **Tool rows (V/P).** One-line summaries; results folded with `(ctrl+o to expand)`; `ctrl+o` opens the transcript. Diagnostics: `Found 3 new diagnostics in 2 files (ctrl+o to expand)`. Fullscreen adds click to expand (P).
- **Permission prompts (V).** Descriptor objects: `{title: "Edit file", question: {kind:"plain", text:"Do you want to proceed?"}, content:{kind:"tool-use-line"}}`. Options come from a `Select` with `inlineDescriptions`, `onCancel`, and an input mode toggle (tab to add a note). Typical rows: "Yes", "Yes, and don't ask again for `git:*` commands in <dir>", "Yes, allow reading from <dir>", "No, and tell Claude what to do differently". Diff content is a separate panel (`DiffPanel` context, `app:toggleDiffNoiseFilter`, file list up/down).
- **Toasts and hints (V).** A notification queue with priorities (`priority:"immediate"`, `kind:"hint"`), fixed toast geometry constants (`TOAST_BOX_COLUMNS`, `TOAST_STACK_VISIBLE`, `TOAST_RESERVED_ROWS`): they reserve rows so the layout does not jump.

## 4. First run, theme, tips

- **Welcome (V).** `Welcome to Claude Code for <version/product>`, then "Choose the text style that looks best with your terminal" (theme picker with live preview: `setPreviewTheme`), then login, then trust dialog (P).
- **Theme auto-detect (V).** Two paths: a query `OSC 11` ("systemTheme: OSC 11 query (via=...) got no response" is logged, and responsiveness is cached as `osc11Responsive`), and DEC mode 2031 push notifications (regex `^\x1b\[\?997;([12])n$`, log line `systemTheme: theme-change push`). A `themeSetting` of auto follows the OS live, no restart.
- **Tips (V).** Persisted `tipsHistory` map (tip id to startup number) and `numStartups`; a tip is chosen by how long since it was last shown (`GB(t)=numStartups - tipsHistory[t]`), and context tips exist ("Use /clear to start fresh when switching topics" after 30 min idle, "Use /btw ..." after 30 s). Tips are opt-out (`spinnerTipsEnabled`), and each hint is one dim line, never a modal.

## 5. What else makes it smooth

- **Notifications (V).** Setting `preferredNotifChannel`: `auto`, `iterm2`, `iterm2_with_bell`, `kitty`, `ghostty`, `terminal_bell`, `notifications_disabled`. `auto` picks by terminal. OSC sequences carry the message.
- **Terminal title (V).** `terminalTitle` modes in the bundle: `disabled`, `serviceName`, `sessionTitle`, `aiSessionTitle`, `agentTitle`...; title follows the session rename.
- **Terminal compatibility work (V).** Special-case JetBrains/jediterm (`internal_jediTermInput`), tmux, VS Code; keyboard dialect by `TERM` (`keyDialect:NBt(i.TERM)`); focus events (1004) to know when to notify.
- **Feature flags with telemetry on the UI itself (V).** Every UI path logs a gate (`tengu_*`), including fullscreen upsell shown-counts (`fullscreenUpsellSeen`, limit `zBt=3`), so changes roll out gradually and failed starts roll back.
- **Not determined (?):** the exact base frame interval; how the diff encodes cells (typed arrays per the engineer, P); exact collapse line limits for tool output; spinner animation timings. Resolving these needs the minified symbol graph (REA `analyze_javascript_application` would do it) and was skipped to stay within budget.

## What Remy already has

From `terminal.ts`: DEC 2026 probe (DECRQM) and OSC 11 query, focus events, sync-marker handling. From `apps/cli/src/screen/`: alternate screen, sticky scroll, sidebar, dialogs, tips, motion, spinner, `chat-keys.ts`, `input-history.ts`, `mentions.ts`. The gaps below are therefore about behaviour, not the basics.

## What Remy should take (ranked)

| #   | Take                                                                                                                                | User-visible effect                                                 | Size | Remy files                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| 1   | Input-priority frame pacing: base interval for stream frames, ~4 ms for 50 ms after each key                                        | Typing never lags behind a streaming reply                          | S    | `screen/full-app.ts`, `stream.ts`, `live-hooks.ts`                |
| 2   | Stdout backpressure: skip or delay a frame while the write queue exceeds ~16 KiB                                                    | No lag or stale frames over SSH or slow terminals                   | S-M  | `terminal.ts`, `screen/full-app.ts`                               |
| 3   | Queue input while a turn runs, with "send now" (interrupt and send) distinct from "queue"                                           | Owner can type the next instruction without waiting or losing it    | M    | `chat.ts`, `chat-keys.ts`, `screen/prompt-box.ts`                 |
| 4   | Paste placeholders `[Pasted text #1 +N lines]` backed by a cache, flagged untrusted                                                 | Big pastes stay readable; recalled prompts still send the full text | M    | `input.ts`, `input-history.ts`, `screen/prompt-box.ts`, `chat.ts` |
| 5   | Keybindings as a data table with contexts, chords and a user file; hints derived from the resolved binding                          | Remappable keys, hints always match, fewer hard-coded branches      | M-L  | `chat-keys.ts`, `prefs.ts`, `hints.ts`                            |
| 6   | DEC 2031 theme push (`ESC[?2031h`, reply `ESC[?997;1n` dark or `2n` light) next to the OSC 11 probe                                 | Theme follows the OS live without a restart                         | S    | `terminal.ts`, `theme.ts`, `theme-command`                        |
| 7   | One mode registry that reasserts bracketed paste, mouse, alt screen and focus after suspend or reattach                             | Ctrl+Z / fg and tmux reattach do not leave a broken screen          | S-M  | `terminal.ts`, `screen/full-app.ts`                               |
| 8   | Auto-fallback to `--minimal` after repeated failed starts, plus an env opt-out for alt screen and mouse                             | A broken terminal never traps the owner in a blank UI               | S    | `main.ts`, `prefs.ts`, `cli.ts`                                   |
| 9   | Tip scheduler with persisted history (show least recently shown, context-triggered, one dim line, opt-out)                          | Features get discovered without a tour                              | S    | `screen/tips.ts`, `prefs.ts`                                      |
| 10  | Notification channel setting (auto, bell, OSC for iTerm2/kitty/ghostty, off) fired when blocked on approval or done while unfocused | Owner can leave the window and still hear when Remy needs them      | S-M  | `terminal.ts`, `chat.ts`, `prefs.ts`                              |

Also worth a later look, not ranked: a terminal title that follows the session name, reserved toast rows so layout never jumps, and a diff panel with a noise filter for approvals.

## Sources

- Installed build: `~/.local/share/claude/versions/2.1.312` (read-only grep of embedded JS; no extraction).
- https://code.claude.com/docs/en/fullscreen, https://code.claude.com/docs/en/terminal-config, https://code.claude.com/docs/en/interactive-mode (via `claude-code.md`).
