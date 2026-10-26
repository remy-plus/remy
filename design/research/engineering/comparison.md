# Engineering comparison

Basis: `opencode.md` (source, v1.19.4), `cline.md` (source, desktop-v0.0.48), `claude-code.md` (public information only), and Remy at commit `abb9257`. "V" is verified in source, "P" public statement, "I" inferred.

## Side by side

| Decision     | OpenCode                                                        | Cline (TUI)                                                        | Claude Code                                                                        | Remy today                                                          |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Framework    | OpenTUI + SolidJS (V)                                           | OpenTUI + React 19 (V)                                             | React with a custom renderer after Ink (P)                                         | Ink 8 + React 19, no JSX (V)                                        |
| Render model | Native cell diff, retained tree (I)                             | same family (I)                                                    | Own diff renderer, ~16 ms budget (P)                                               | Ink: `Static` for committed items plus a small live area (V)        |
| Screen       | Alternate screen, own scroll (I)                                | Alternate screen, own scroll (I)                                   | Fullscreen is default for new users, classic native scrollback still available (P) | Native scrollback, no alternate screen (V)                          |
| Streaming    | Signals update one node (I)                                     | React state (I)                                                    | Diffed frames (P)                                                                  | `onText` into one buffer, last lines shown live, committed once (V) |
| Spinner      | 80 ms braille plus gradient scanner (V)                         | `opentui-spinner` dots (V)                                         | Colour shimmer (P)                                                                 | Braille glyph with elapsed seconds (V)                              |
| Input        | Multiline textarea, history, paste extmarks, `@` search (V)     | Textarea, Shift/Ctrl+Enter, 5-line paste collapse, image paste (V) | Multiline, vim mode, paste placeholder with cache (P)                              | Single line, pasted newlines become spaces, history recall (V)      |
| Tool display | Inline row; block only for edit and bash (V)                    | Inline response per tool (V)                                       | One-line summaries; click to expand in fullscreen (P)                              | One line per tool, failures collapsed, up to 8 live rows (V)        |
| Approval     | Replaces prompt; once/always/reject-with-message; diff (V)      | Dialog; y/Enter, n/Esc; parameter list (V)                         | Select menu in the stream; modes (P)                                               | Card with y/n, risk line, diff-like rows (V)                        |
| Plan/todo    | Sidebar Todo plugin (V)                                         | Plan/Act mode; checklist in webview (V)                            | Task list in the stream (P)                                                        | `PlanList` up to 5 rows (V)                                         |
| Thinking     | Hidden by default; titled spinner from reasoning summary (V)    | Collapsible row (webview, V)                                       | Collapsed (P)                                                                      | Generic "Thinking" label (V)                                        |
| Status       | Footer: cwd, permissions, LSP/MCP; sidebar context and cost (V) | Mode, tokens, cost, context bar, auto-approve (V)                  | User-scripted status line (P)                                                      | Model, tokens, cost, phase word, hints (V)                          |
| Keys         | Leader `ctrl+x`, palette `ctrl+p`, which-key (V)                | Command palette, dialogs (V)                                       | Remappable file, vim mode (P)                                                      | Small fixed set (V)                                                 |
| Themes       | JSON, semantic keys, dark/light pairs, `none` (V)               | Palette probe plus themes (V)                                      | Presets plus JSON overrides, auto light/dark (P)                                   | One palette, 3 color levels (V)                                     |
| Resize       | Signals recompute layout (I)                                    | `useTerminalDimensions` (V)                                        | Redraw (P)                                                                         | Live area follows width; committed items do not re-wrap (V)         |
| Sessions     | Server owns; session list dialog (I)                            | History view, hydrate messages (V)                                 | On-disk transcripts, resume, rewind (P)                                            | Event store; `remy resume`, `remy list` (V)                         |
| Tests        | Not examined                                                    | Unit plus a TUI e2e harness (`tuistory`) (V)                       | Not public                                                                         | Unit, `ink-testing-library`, pty smoke (V)                          |
| Safety UX    | Allow always (V)                                                | Auto-approve menu, YOLO (V)                                        | Permission modes (P)                                                               | Single-use, `argsHash`-bound (V)                                    |

## Strongest decisions, ranked for Remy

1. **Interrupt replaces the prompt** (OpenCode). Already in Remy; extend with reject-with-note.
2. **Inline rows, detail only where it matters** (OpenCode).
3. **Synchronized output + native scrollback** (Claude Code classic mode): flicker fix without giving up search and copy.
4. **Checkpoint rows with Compare and Restore** (Cline): maps to Remy's `reconcilable` tools.
5. **Always-visible tokens, cost, context bar** (Cline).
6. **Paste collapse with cache and untrusted flag** (Cline, Claude Code).
7. **Capture stdio while the UI runs** (Cline).
8. **Thinking title from a reasoning summary** (OpenCode).
9. **Palette probe with a timeout, then semantic tokens** (Cline, OpenCode, Claude Code).
10. **Notifications when blocked** (Claude Code, Cline).

## Decisions not to copy

- Alternate screen, mouse capture, own scrollbar: costs native search and copy, and three teams are still fixing the edge cases.
- "Always allow" and YOLO: contradict single-use approvals.
- Plugin slots in the UI: premature for one product.
- A second renderer (OpenTUI): a native build step and a rewrite of the test harness for no user-visible gain today.

## Maintainability

Ink keeps Remy to one dependency family, pure-function helpers (`transcript.ts`, `input.ts`, `markdown.ts`) and `ink-testing-library` tests. The cost is Ink's full-frame redraw of the live area, which is why the live area is capped (`MAX_TOOL_ROWS`, tail lines). Keep that discipline: the more that lives in `Static`, the cheaper each frame.
