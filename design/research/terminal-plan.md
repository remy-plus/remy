# Remy terminal plan

Written 2026-10-25 against commit `abb9257`. Plan only; no code changed. It implements the terminal half of `remy-direction.md` and wins any conflict with it. Findings it relies on: `engineering/comparison.md`.

## Goal and constraints

A calm, capable assistant that says what it is doing and why, asks before anything consequential, and never hurries. Not a copy of any reference.

Constraints: keep Ink and native scrollback (no alternate screen, no mouse capture); `core` stays UI-free; `pnpm check` green at each step; color only via `theme.ts`; copy follows the brand voice; every item lists its tests.

## What exists (read in source)

- `chat.ts`: controller with `ChatState` (`phase`, `items`, `streaming`, `thinking`, `tools`, `plan`, `approval`, `queue`, `costUsd`, `tokens`, `retrying`); fed by `RuntimeHooks { onEvent, onText, onModelStart }`.
- `chat-ui.ts`: `ChatApp` = `Static` (committed items) + `Live` (tail of stream, plan, tool rows, approval, queue, spinner) + `Prompt` + `Footer`. `useInput` handles keys.
- `transcript.ts`: `summarizeTool`, `describeApproval`, `flushTools`, `collapseFailure`.
- `input.ts`: single-line editor; pasted newlines become spaces.
- `theme.ts`, `markdown.ts`, `format.ts`.
- Tests: `chat-ui.test.ts` (ink-testing-library), `chat.test.ts`, `transcript.test.ts`, `input.test.ts`, `apps/cli/scripts/pty-smoke.py` (real pty replayed into pyte).

## Phase 1: Narration, footer (S, 1 day)

Make the status line say what and why.

- `transcript.ts`: add `narrate(state): string`. Sources, in order: running tool (`verb target`), plan step in `doing`, streaming ("Writing"), else "Thinking". Output like `Grouping 212 files by type · step 3 of 4 · 12s`. Pure function, no Ink.
- `chat-ui.ts` `Live`: replace the inline label logic (`Writing`/`Working`/`Thinking`) with `narrate`. Keep `animate` and the reduced-motion form (`...`).
- `Footer`: add context fill and budget when known: `model · 14% context · $0.04 of $0.50 · working`. Needs `contextTokens`, `contextWindow` and `budgetUsd` in `ChatState`; `chat.ts` already tracks `tokens` and `costUsd` from events. Confirm where budget lives in `TaskConfig` before adding.
- Tests: unit for `narrate` table (each phase); `chat-ui.test.ts` frame contains narration and no duplicate lines; pty-smoke: add a check that the narration line never lands in scrollback.
- Risk: narration changing every tick re-renders the live area; keep it one row and update once a second.

## Phase 2: Approval card v2 (M, 2 days)

- `transcript.ts` `ApprovalView`: add `callId`, `shortHash` (first 6 of `argsHash`), `reversible: boolean` (from tool `effect`), `more: number` (rows hidden). `describeApproval` fills them.
- `chat-ui.ts` `ApprovalCard`: title line, up to 6 action rows, risk line in plain words, binding line `Approval covers exactly this call (a41f9c).`, keys `y approve once · n deny · e deny and say why`. `v` toggles all rows.
- `chat.ts`: `approve(true|false, note?)`; the note becomes the tool result text the model sees (a denial with guidance). Check `RemyRuntime.resolveApproval` accepts a reason; if not, a small `packages/core` change (see Runtime hooks).
- Keys: add `e` (switches the prompt to a one-line note entry, Enter submits as a denial). Never bind Enter to approve.
- Tests: unit for `describeApproval` (hash, reversible, more); ink-testing-library: `y`, `n`, `e` then text then Enter; a stray Enter does nothing; pty-smoke: approval turn ends the wait and the card is in scrollback once.
- Risk: long diffs; `v` expands in the live area only up to `rows - below`, beyond that it goes to the transcript view (Phase 3).

## Phase 3: Tool lines, transcript view (M, 2-3 days)

- `ToolLine` gains `detail?: string[]` (first N lines of output, or edit hunks) captured from `tool.finished` events. Rows stay one line; a running command may show a one-line tail (needs `onToolOutput`, below).
- `TranscriptView` component (new, `apps/cli/src/transcript-view.ts`): `Ctrl+O` swaps `Live`+`Prompt` for a scrollable page of all items with details expanded; `/` search, `j/k`, `q`/Esc back; `[` writes everything to native scrollback and exits. Props `{ items, columns, rows, onClose }`; state `{ top, query, matches }`. Windowed render only (rows - 2), so it stays cheap.
- Slow tools (over 2 s) show elapsed time (already in `ToolRow`); failures keep collapsing.
- Tests: unit for window math and search; ink-testing-library for open/close, `[` output; pty-smoke: after `Ctrl+O` then `[`, scrollback has details.
- Risk: Ink cannot own the alternate screen; the view is a normal frame sized to `rows`. Acceptable; it is temporary.

## Phase 4: Multiline input and paste (M, 2-3 days)

- `input.ts`: change `InputState` to `{ text, cursor }` with `\n` allowed; add `Ctrl+J` and `\`+Enter newline, up/down line moves when the text has several lines (history recall only on the first/last line), Alt+Backspace word delete, `Ctrl+W`, `Ctrl+K`.
- Bracketed paste: Ink 8 delivers pasted chunks through `useInput`; detect `\x1b[200~`/`\x1b[201~` markers or use Ink's paste handling if present (verify in the installed version). Pastes of 5+ lines or over 800 chars become `[Pasted 120 lines]` marker; `InputState` gains `pastes: Record<number,string>`; submission expands them. The expanded text is flagged as pasted in the task context so the untrusted-output rule can apply (check with `packages/core` taint API).
- `Prompt` renders multiple rows; `promptRows` already exists, update it to count `\n`.
- Tests: `input.test.ts` (newline, paste marker, deletion of a marker whole, history at line edges); ink-testing-library for paste; pty-smoke: type a multi-line message via `\` Enter and a bracketed paste.
- Risk: the biggest behavioural change; ship behind `REMY_INPUT=single` fallback for one release.

## Phase 5: Terminal manners (S, 1-2 days)

- Synchronized output: wrap each Ink frame write with `\x1b[?2026h` ... `\x1b[?2026l` when the terminal replies to a `\x1b[?2026$p` query (or `TERM_PROGRAM` is known). Implement as a `stdout` wrapper in `chat-ui.ts` `runChat`, off when not a TTY. Check Ink 8 for a built-in option first.
- Capture stray `console` and stderr writes while mounted (`patchConsole` is currently false); route to `--debug` log (cf. Cline `stdio-capture.ts`).
- Notify: when entering `waiting_approval` or `waiting_user` and the terminal is unfocused (focus reporting `\x1b[?1004h`), emit bell or OSC 9. Setting `REMY_NOTIFY=off`.
- Theme: add `error`, `diffAdd`, `diffDel` roles to `theme.ts`; probe light/dark once (OSC 11 with 150 ms timeout), keep `NO_COLOR` behaviour.
- Tests: unit for the wrapper and role mapping; pty-smoke: confirm the markers appear around frames in a capable pty and not with `TERM=dumb`.
- Risk: terminals that echo unknown sequences; gate on the DECRQM reply.

## Phase 6: Sessions, thinking (M-L, 3+ days)

- `/resume` picker (`apps/cli/src/session-picker.ts`): list from `remy list` data, show title, age, state; arrows and Enter. Resume banner: `Resuming 7c2e: 2 of 4 steps done. Next: move files.`
- Thinking: hook `onReasoning` (below); `Live` shows `Thinking: <title>` when a title exists; `/thinking` toggles detail. Off by default.
- Tests: picker unit and ink-testing-library; chat test for the banner from a fixture event log.
- Risk: reasoning summaries exist only for some providers; no summary means no line.

## Runtime hooks needed in `packages/core`

| Hook                                                                                                                   | Why                                | Effort |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| `onReasoning?(delta: string)` plus `ModelClient` support to stream reasoning summaries where the provider returns them | Phase 6 thinking title             | M      |
| `onToolOutput?(callId, chunk)` for long-running `run_command`                                                          | one-line tail while a command runs | M      |
| `resolveApproval(id, { approved, note })` if not already supported                                                     | deny-with-note                     | S      |
| Expose `contextWindow` per model and `budgetUsd` in a getter on the runtime                                            | footer meters                      | S      |

None is required for Phases 1, 3 (without tail), 4, 5.

## Order and shipping

1 → 2 → 5 → 3 → 4 → 6. Phases 1, 2 and 5 are small and change how Remy feels most. Each phase is its own commit series ending green on `pnpm check`; Phase 4 ships behind a fallback.

## Not doing

Alternate screen, mouse capture, sidebar, "always allow", extra themes, OpenTUI, plugin slots.

## Open questions

- Does Ink 8 offer synchronized output or bracketed paste hooks? Check before writing wrappers.
- Where does the budget live for a conversation?
- Should `e` (deny with note) also be available through `remy approve <id> --note`?
