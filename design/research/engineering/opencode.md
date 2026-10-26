# OpenCode: how the terminal UI is built

Source read: the sst/opencode repository, tag **v1.19.4** (published 2026-10-22), downloaded as a tarball on 2026-10-25. The commit hash was not recorded (tarball, not a clone). License MIT. Paths below are relative to the repo root.

## Architecture

OpenCode's UI is a separate package, `packages/tui` (`@opencode-ai/tui` 1.19.4), that talks to the agent server over an SDK. The renderer is **OpenTUI** (`@opentui/core`, Zig-backed) with the **SolidJS** reconciler (`@opentui/solid`) and an `@opentui/keymap` package. The earlier Go/Bubble Tea UI was replaced in 1.0.

- **Rendering:** a retained scene graph of `box`, `text`, `scrollbox`, `diff`, `textarea` nodes; OpenTUI lays out and diffs cells natively. Fine-grained Solid signals mean a streamed token updates one text node, not a tree.
- **Screen mode:** the call is `createCliRenderer({ targetFps: 60, useMouse, useKittyKeyboard, externalOutputMode: "passthrough", exitOnCtrlC: false })`. Whether it uses the alternate screen is decided inside OpenTUI, which is not in this repo (see table).
- **State:** context providers (`context/sync.tsx`, `data.tsx`, `local.tsx`, `kv.tsx`, `route.tsx`) feed a session route. Persistent UI settings (sidebar, thinking mode) go through a KV store.
- **Extensibility:** a plugin runtime with slots (`plugin/slots.tsx`, `feature-plugins/`): the sidebar sections, footer, diff viewer and which-key are themselves plugins.

## File map

| Concern                                       | File                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Renderer creation, app shell                  | `packages/tui/src/app.tsx` (1085 lines)                                                        |
| Session screen, message list, tool components | `packages/tui/src/routes/session/index.tsx` (2641)                                             |
| Permission prompt                             | `routes/session/permission.tsx` (719)                                                          |
| Question prompt                               | `routes/session/question.tsx` (515)                                                            |
| Footer                                        | `routes/session/footer.tsx`; sidebar `routes/session/sidebar.tsx`, `feature-plugins/sidebar/*` |
| Prompt editor                                 | `component/prompt/index.tsx` (1716), `autocomplete.tsx` (781)                                  |
| Spinner and gradients                         | `component/spinner.tsx`, `ui/spinner.ts`                                                       |
| Tool output collapse                          | `util/collapse-tool-output.ts`                                                                 |
| Thinking mode                                 | `context/thinking.ts`                                                                          |
| Theme                                         | `theme/index.ts` (1089), `theme/assets/*.json`                                                 |
| Keybinds                                      | `config/keybind.ts`, `keymap.tsx`, `feature-plugins/system/which-key.tsx`                      |
| Notifications                                 | `attention.ts`                                                                                 |

## Verified versus inferred

| Claim                                                                                                             | Status                     | Evidence                                                            |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| UI is OpenTUI + SolidJS in `packages/tui`                                                                         | Verified                   | `package.json` deps; `app.tsx`                                      |
| 60 fps cap, Kitty keyboard protocol, optional mouse                                                               | Verified                   | `app.tsx` lines 177-186                                             |
| Session view is a `scrollbox` with `stickyScroll` and `stickyStart="bottom"`                                      | Verified                   | `routes/session/index.tsx` ~1115-1129                               |
| Sidebar: 42 columns, auto above 120 columns, toggle                                                               | Verified                   | `index.tsx` lines 254-276                                           |
| Prompt and permission/question prompts share a bottom slot; permission replaces prompt                            | Verified                   | `index.tsx` ~1232-1262                                              |
| Tool components: `InlineTool` row (icon, verb, target, spinner, strikethrough on deny) and `BlockTool` for bodies | Verified                   | `index.tsx` 1771-1990                                               |
| Permission options: Allow once / Allow always / Reject (reject asks for a message); diff shown for edits          | Verified                   | `permission.tsx` ~193-440                                           |
| Thinking defaults to hidden; spinner label "Thinking: <title>" from `**title**` of reasoning summary              | Verified                   | `context/thinking.ts`, `index.tsx` ~1609                            |
| Prompt history, paste "extmarks", `@` autocomplete                                                                | Verified (names, handlers) | `component/prompt/index.tsx`                                        |
| Footer: cwd, permission count, LSP and MCP counts                                                                 | Verified                   | `footer.tsx`                                                        |
| 80 ms braille spinner                                                                                             | Verified                   | `component/spinner.tsx`                                             |
| Uses the alternate screen                                                                                         | **Inferred**               | Full-height scrollbox and own scrolling; OpenTUI internals not read |
| Streaming path (events to Solid store to text node)                                                               | **Inferred**               | `context/sync.tsx` structure; not traced line by line               |
| Resize handling                                                                                                   | **Inferred**               | Uses `dimensions()` signals (`width() > 120`); OpenTUI re-lays out  |
| Session persistence and resume                                                                                    | **Inferred**               | Server owns sessions (`/sessions`, `ctrl+x l`); the TUI is a client |

## Tradeoffs

- **Pros:** very smooth streaming, mouse, scrollbars, a real textarea, split diffs; extensible through slots.
- **Cons:** needs the Bun/Zig toolchain and a native binary per platform; terminal scrollback and native copy are given up; 2.6k-line route file; Solid and OpenTUI are young (the 1.0 release removed several features and the `system` theme for a while).

## Lessons for Remy

1. Inline rows by default, block bodies only for edits and commands.
2. Replace the prompt with the interrupt (permission, question); never stack it above the stream.
3. Collapse long tool output to N lines and `…`, with a way to expand.
4. A thinking title from the first bold line of a reasoning summary is a cheap, honest status.
5. Do **not** adopt OpenTUI for Remy now: it would replace Ink, the pty smoke harness, and the no-native-toolchain install. Revisit if streaming performance or a real textarea becomes the bottleneck.
