# Cline: how its interfaces are built

Source read: the cline/cline repository, tag **desktop-v0.0.48** (published 2026-10-17), downloaded as a tarball on 2026-10-25; commit hash not recorded. License Apache 2.0. Paths are relative to the repo root.

## Three UIs, one runtime

| Surface         | Stack                                                                                                                         | Where                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| VS Code webview | React 18, Vite 7, Tailwind 4, HeroUI, styled-components, framer-motion, `react-virtuoso` for the message list, `lucide-react` | `apps/vscode/webview-ui/` |
| Terminal UI     | **OpenTUI** (`@opentui/core` and `@opentui/react` 0.4.3) with React 19, `opentui-spinner`, `@opentui-ui/dialog`               | `apps/cli/src/tui/`       |
| Desktop app     | Not read: only the docs and the example app (`apps/examples/desktop-app`) were looked at                                      | n/a                       |

The agent runtime is shared (`@cline/core`, `@cline/shared`, `sdk/`); the TUI imports types such as `ToolApprovalRequest` from it.

## Terminal UI

- **Bootstrap** (`tui/index.tsx`): `createCliRenderer({ exitOnCtrlC: false, autoFocus: false, enableMouseMovement: true })`, then queries the terminal palette (`renderer.getPalette`, 150 ms timeout) and paints the theme background before the first frame to avoid a flash.
- **stdio capture** (`tui/stdio-capture.ts`): replaces `process.stdout.write` while the TUI is up, so stray logging cannot corrupt the screen; restores on exit.
- **Layout** (`views/chat-view.tsx`, `components/chat-message-list.tsx`): `box` column; a `scrollbox` with keyboard scroll (half and quarter page, top, bottom); an input bar; a status bar.
- **Input** (`components/input-bar.tsx`): OpenTUI `textarea`; Shift+Enter and Ctrl+Enter insert newlines; Ctrl+V pastes images; pastes of 5 or more lines collapse into a marker (`utils/pasted-snippets.ts`); `autocomplete-dropdown.tsx` for `/` and `@`.
- **Tool display** (`components/inline-tool-response.tsx`, `tool-output.tsx`, `chat-entry.tsx`): inline response per tool; `utils/tool-parsing.ts` parses each tool's args into display fields.
- **Approvals** (`components/dialogs/tool-approval.tsx`, 177 lines): a dialog titled "Approve tool call?" listing parameters per tool (files with line ranges, `$ command`, URLs); keys `y` or Enter approve, `n` or Esc deny.
- **Status bar** (`components/status-bar.tsx`): Plan/Act indicator, tokens and cost, a context bar built from block glyphs, and an auto-approve marker (platform-dependent glyph because U+23F5 is missing in many Linux fonts).
- **Other**: command palette, checkpoint picker (`checkpoint-picker-items.ts`), history view, onboarding, themes (`themes.ts`, `palette.ts`), model selector.
- **Tests**: unit tests colocated, plus `cli.tuistory.e2e.test.ts` (a TUI-driving e2e harness) and interactive e2e configs.

## Webview

`ChatView` with `react-virtuoso` virtualized rows; `ChatRow` dispatches to row components (`DiffEditRow`, `CommandOutputRow`, `ThinkingRow`, `CompletionOutputRow`, `ErrorRow` and many error variants); `task-header/` holds `TaskHeader`, `ContextWindow` (context bar) and the working-directory badge; `auto-approve-menu/` holds the consent toggles; `messageReducer.ts` folds streamed messages into rows. `ThinkingRow` animates max-height over 250 ms.

## Verified versus inferred

| Claim                                                          | Status       | Evidence                                                                |
| -------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| TUI uses OpenTUI + React 19                                    | Verified     | `apps/cli/package.json`; `tui/index.tsx`                                |
| stdout is captured during the TUI                              | Verified     | `stdio-capture.ts`                                                      |
| Message list is a `scrollbox` with keyboard paging             | Verified     | `chat-message-list.tsx`                                                 |
| Approval keys y/Enter and n/Esc; parameter list per tool       | Verified     | `tool-approval.tsx`                                                     |
| Large-paste threshold 5 lines                                  | Verified     | `pasted-snippets.ts`                                                    |
| Status bar shows mode, tokens, cost, context bar, auto-approve | Verified     | `status-bar.tsx`                                                        |
| Webview uses virtualized list and framer-motion                | Verified     | `webview-ui/package.json` (deps), file names                            |
| Alternate screen use in the TUI                                | **Inferred** | OpenTUI default; not confirmed in Cline code                            |
| Streaming path in the TUI                                      | **Inferred** | `contexts/session-context.tsx`, `hydrate-messages.ts` exist; not traced |
| Resize behaviour                                               | **Inferred** | `useTerminalDimensions` in `root.tsx`                                   |
| Session resume                                                 | **Inferred** | `views/history-view.tsx` and `utils/hydrate-messages.ts` exist          |
| Desktop app internals                                          | Not read     | docs only                                                               |

## Tradeoffs

- One runtime, three UIs keeps behaviour identical, but each UI needs its own approval and diff presentation.
- Cline moved its terminal UI to OpenTUI + React, the same renderer family as OpenCode: a signal that Ink-class libraries hit limits for rich agent UIs (inferred motive; not stated in the sources read).
- Capturing stdio is a cheap, robust guard that Remy should copy.

## Lessons for Remy

1. Capture stdout and stderr while the UI is mounted.
2. Probe the terminal palette once with a short timeout, then fall back.
3. Parse each tool's args into display fields in one module (Remy's `summarizeTool` and `describeApproval` already do this).
4. Collapse big pastes into a marker, keep the full text for submission.
5. Show tokens, cost and context fill always, with a block-glyph bar.
6. Pick glyphs that exist in common mono fonts; keep a fallback.
