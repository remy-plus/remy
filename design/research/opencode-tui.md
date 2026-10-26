# OpenCode terminal UI

Accessed 2026-10-25. OpenCode v1.19.4 (released 2026-10-22). Source-level detail is in `engineering/opencode.md`; this file is about how it looks and feels.

## Summary

OpenCode is a full-screen TUI: a scrolling message list, a prompt at the bottom, a one-line footer, and a sidebar that appears on wide terminals. Its feel comes from three choices. Tool calls are single dim lines, not boxes. Anything that needs you (permission, question) replaces the prompt in place. Everything else (models, sessions, themes, commands) lives in one palette, so the main screen stays quiet.

## Anatomy (layout verified in `routes/session/index.tsx`; appearance inferred)

```
┌──────────────────────────────────────────────┬─────────────────────┐
│  (blank row)                                 │ session title       │
│  you: rename the config loader               │ context  42% · $0.31│
│                                              │ MCP / LSP           │
│  Thinking: Inspecting loader                 │ Todo                │
│  ✱ Glob "config*"            (inline, dim)   │  [x] find loader    │
│  → Read src/config.ts                        │  [ ] rename         │
│  ┌ Edit src/config.ts ─────────────┐ (block) │ Modified files      │
│  │ diff, split on wide, stacked    │         │  src/config.ts +3 -3│
│  └─────────────────────────────────┘         │                     │
│  Renamed loadConfig to readConfig.           │                     │
│ ┌──────────────────────────────────────────┐ │                     │
│ │ prompt  (textarea, agent + model below)  │ │                     │
│ └──────────────────────────────────────────┘ │                     │
│ ~/proj                  △ 1 Permission • LSP │                     │
└──────────────────────────────────────────────┴─────────────────────┘
```

The sidebar is 42 columns, auto-shown above 120 columns, toggleable (`session.sidebar.toggle`). Verified in source.

## Patterns

| Pattern                       | How it looks and behaves                                                                                                                                               | Why it works                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Inline tool rows              | One row, icon + verb + target, dim; `~ pending text` while waiting; strikethrough when denied; spinner while running                                                   | Dozens of calls stay scannable; failure is the only loud state        |
| Block tools for edit and bash | Only these get a bordered body (diff, output). The 1.0 notes: "Full details appear only for the edit and bash tools"                                                   | Detail where it matters, silence elsewhere                            |
| Output collapse               | `collapseToolOutput` keeps N lines then `…`                                                                                                                            | Bounded height                                                        |
| Thinking                      | Hidden by default (`thinking_mode` = hide); when shown, a spinner row `Thinking: <title>` using the first bold line of a reasoning summary                             | Honest progress without a wall of reasoning                           |
| Permission prompt             | Replaces the prompt. Title (`Edit src/x.ts`), body (diff or path), options `Allow once / Allow always / Reject`; Reject asks for a message                             | The action is visible where you were typing; rejection carries intent |
| Questions                     | Same slot, own component (`question.tsx`)                                                                                                                              | One interrupt surface                                                 |
| Command palette               | `ctrl+p` lists every command                                                                                                                                           | Replaces memorising bindings                                          |
| Leader key                    | `ctrl+x` then a letter, 2000 ms timeout; a which-key overlay lists options                                                                                             | Many bindings without modifier collisions                             |
| Prompt                        | Multiline textarea; `@` file search, `!` shell, `/` commands; pasted text becomes inline "extmarks"; prompt history                                                    | Context attached without leaving the keyboard                         |
| Agents                        | `tab` cycles build and plan; plan is read-only                                                                                                                         | Mode is one keypress                                                  |
| Themes                        | JSON, semantic keys (`text`, `textMuted`, `border`, `diff*`, `markdown*`), `{dark, light}` pairs, `none` = terminal default, an adaptive "system" theme from ANSI 0-15 | Works on any background                                               |
| Motion                        | 80 ms braille spinner; scanner gradient (`ui/spinner.ts`); render cap 60 fps                                                                                           | Small, purposeful                                                     |
| Scrolling                     | Own scrollbox, `stickyScroll` to bottom, optional acceleration, mouse on by default                                                                                    | Smooth, but terminal scrollback is not used (inferred)                |

## Borrow

- Inline-by-default tool rows with detail only for edits and commands.
- Replace-the-prompt interrupts for approvals and questions (Remy already hides the prompt while an approval waits).
- Semantic theme keys with a terminal-default mode.
- A which-key style hint for any chord.
- Reject-with-message: a denial that tells the agent what to do instead.

## Do not borrow

- "Allow always". Remy approvals bind to `argsHash` and are single use by design.
- Alternate screen and mouse capture. Remy keeps native scrollback and copy (see `terminal-plan.md`).
- A permanent sidebar. Remy's identity is one calm column.
- Dozens of built-in themes. One palette, plus the terminal's own colors.

## Sources

- https://opencode.ai/docs/tui/ (2026-10-25)
- https://opencode.ai/docs/keybinds/ (2026-10-25)
- https://opencode.ai/docs/permissions/ (2026-10-25)
- https://opencode.ai/docs/themes/ (2026-10-25)
- https://opencode.ai/docs/agents/ (2026-10-25)
- https://newreleases.io/project/github/sst/opencode/release/v1.0.0 (2026-10-25): the 1.0 TUI rewrite
- Source: `packages/tui/src/routes/session/*.tsx`, tag v1.19.4 of the sst/opencode repository

Not verified: screenshots or video; the default colors of the `opencode` theme.
