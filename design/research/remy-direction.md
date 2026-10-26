# Remy design direction

Written 2026-10-25 from `opencode-tui.md`, `cline.md`, `claude-mobile.md` and the engineering study. The terminal items here are the summary; `terminal-plan.md` holds the implementation detail and is the tie-breaker if the two ever differ.

## Identity, kept

Quiet, mono, paper on ink. Signal green (`#A8C49A`) only for the cursor and "done". One column, no sidebar, no boxes unless an action needs your decision. Voice: outcome first, no hype, no exclamation marks. What none of the three references do, and Remy should: **narrate what it is doing and why in one calm line, and bind every approval to the exact action.**

Effort: S under a day, M a few days, L a week or more.

## (a) Terminal chat, now

Priority order. Each item lists where it sits in `terminal-plan.md`.

| #   | Change                                                                                                                                                                                                                                         | Effort | Plan phase |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| 1   | **Narration line** replaces the generic "Thinking · step 3 · 12s". It names the current intent from the plan step or last tool ("Comparing 14 flights · step 3 of 5 · 12s").                                                                   | S      | 1          |
| 2   | **Approval card v2**: exact action, what it will change, risk in plain words, `y` approve once, `n` deny, `e` deny with a note the agent sees. Shows the short `argsHash` so the user can see the approval is bound to this call. No "always". | M      | 2          |
| 3   | **Tool lines**: one dim row each, elapsed time on slow ones, failures collapse; detail (output, diff) only for edit and run. Full detail on demand in a transcript view (`Ctrl+O`).                                                            | M      | 3          |
| 4   | **Multiline input**: `Ctrl+J` and `\` + Enter for newline, bracketed paste, large pastes collapse to `[Pasted 120 lines]`.                                                                                                                     | M      | 4          |
| 5   | **Footer**: model, context fill, cost vs budget, phase word, and only the hints that apply now.                                                                                                                                                | S      | 1          |
| 6   | **Plan list** stays, adds step counts to the narration line; hidden when the task has fewer than three steps (already so).                                                                                                                     | S      | 1          |
| 7   | **Flicker-free output**: wrap frames in synchronized output (DEC mode 2026) where supported.                                                                                                                                                   | S      | 5          |
| 8   | **Theme tokens**: semantic roles (text, muted, accent, error, diff add/remove) with auto light/dark and `NO_COLOR`; no extra themes.                                                                                                           | S      | 5          |
| 9   | **Notify when waiting**: terminal bell (or OSC 9) when an approval or question blocks and the terminal is unfocused.                                                                                                                           | S      | 5          |
| 10  | **Session picker** (`/resume`) and a resume banner that says what was done and what is next.                                                                                                                                                   | M      | 6          |
| 11  | **Thinking**: show a model's reasoning summary title only when the provider returns one; hidden by default (`/thinking`). Needs a core hook.                                                                                                   | M      | 6          |

### Mockups

Working, with a plan:

```
  › tidy the Downloads folder

  Plan
  ● Read the folder (212 files)
  ◐ Group by type and year
  ○ Move files
  ○ Report what moved

  · read   ~/Downloads                       0.4s
  · list   ~/Downloads/2025

  ⠹ Grouping 212 files by type · step 3 of 4 · 12s
  ›
  claude-sonnet · context 14% · $0.04 of $0.50 · working     Enter queue · Ctrl+C stop
```

Approval (replaces the prompt; the card is the only boxed element):

```
  Move 38 files into ~/Downloads/Documents/2025
  ─────────────────────────────────────────────
  move   ~/Downloads/inv-0412.pdf  →  Documents/2025/inv-0412.pdf
  move   ~/Downloads/inv-0518.pdf  →  Documents/2025/inv-0518.pdf
  … 36 more (v to view all)
  Risk: changes files. Reversible; Remy keeps the old paths.
  Approval covers exactly this call (a41f9c).

  y approve once   n deny   e deny and tell Remy what to do instead
```

Done (signal on the dot only):

```
  ● Moved 38 files into 4 folders. Nothing deleted.
    Undo: remy undo 7c2e
```

(`remy undo` is proposed, not built. Mockups show intent, not current commands.)

Failure, calm and specific:

```
  The airline site timed out twice. I will retry in a minute.
  Nothing was booked or charged.   remy resume 7c2e
```

### Keybindings

Keep Remy's small set: Enter send, Ctrl+J newline, Esc clear, Up/Down history, Ctrl+C stop, Ctrl+D quit, `Ctrl+O` transcript. No leader key until there are more than about 12 commands; use `/` commands first. `?` on an empty prompt lists keys.

### Motion

One braille spinner (existing), 80 to 120 ms, only on the narration line. No gradients. `--reduced-motion` keeps working: a static `...`.

## (b) Desktop app, later

| Item                                                                                                            | Effort |
| --------------------------------------------------------------------------------------------------------------- | ------ |
| One window: sessions list left (collapsible), one column of conversation, composer bottom. No right-hand panes. | L      |
| Approvals as inline cards with the same wording as the terminal; keyboard `Y`/`N`.                              | M      |
| Activity drawer for the full event log of a task (from `EventStore`), searchable.                               | M      |
| "Undo" row after reversible steps (Cline's checkpoint idea, driven by `reconcilable` tools).                    | M      |
| Schedules page (Cline desktop): one-time and recurring tasks.                                                   | M      |
| Type: JetBrains Mono for chrome and code, a neutral system sans for prose; paper/ink; signal only for done.     | S      |

## (c) Mobile app, later

| Item                                                                                                                                 | Effort |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Single ongoing thread, composer with voice inside it, transcripts kept as text.                                                      | L      |
| Push notification on "needs your approval" with the card in the notification, Approve and Deny buttons bound to the same `argsHash`. | M      |
| Result cards that open (summary, files, undo), action log one tap away.                                                              | M      |
| Resume from any device by task id (already event-sourced).                                                                           | M      |
| Light haptic on approve, none elsewhere.                                                                                             | S      |

## Tensions resolved

- OpenCode shows detail only for edits and commands; Cline shows it for everything. Remy follows OpenCode in the stream and offers the full log on demand.
- Claude Code's fullscreen mode gains flicker-free scrolling but loses native scrollback and search. Remy stays in native scrollback because copy, search and tmux all work, and adds synchronized output.
- Sidebars are useful at 120 columns and a burden at 80. Remy has none; the footer carries the essentials.
