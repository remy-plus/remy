# Cline

Accessed 2026-10-25. Cline desktop v0.0.48 (2026-10-17); the CLI changelog is at 3.0.73; the VS Code webview was read at the same tag. Engineering detail: `engineering/cline.md`.

## Summary

Cline has three surfaces on one runtime: the VS Code and JetBrains extension (a React webview), a desktop app (open source, Mac and a Windows beta, parallel sessions), and a terminal UI (OpenTUI + React). The product idea is human-in-the-loop work: edits and commands are approved, with a diff to review, a checkpoint after each step, and a switch from Plan to Act. Of the three references it is the most "workbench". Remy should borrow its safety ergonomics, not its density.

## Anatomy

Editor (inferred from the component file list, which is verified):

```
┌ Task header: title · tokens · cost · context bar ─────────────┐
│ ▸ checklist (focus chain)                                     │
├───────────────────────────────────────────────────────────────┤
│ Thinking (collapsible, animated)                              │
│ Cline wants to edit  src/a.ts      [diff]   [Approve] [Reject]│
│ ⚑ Checkpoint ····· [Compare] [Restore ▾]                      │
│ Command output row (expandable)                               │
├───────────────────────────────────────────────────────────────┤
│ Auto-approve ▾ (toggles)        [ Plan | Act ]                │
│ > message…   @ file   / command                               │
└───────────────────────────────────────────────────────────────┘
```

Terminal UI: a scrolling chat view, an input bar, and a status bar with `● Plan  ○ Act`, `(<tokens>) $cost`, a context bar of block glyphs, and an auto-approve marker. Verified in `apps/cli/src/tui/components/status-bar.tsx`.

## Patterns

| Pattern           | Behaviour                                                                                                                                                                           | Why it works                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Plan and Act      | Plan cannot edit or run; Act can; history carries over; optional model per mode                                                                                                     | Thinking and doing are separate and visible   |
| Per-step approval | Each edit and command asks. TUI: `y` or Enter approves, `n` or Esc denies, parameters shown dim                                                                                     | Trust is earned step by step                  |
| Auto-approve menu | Nine settings (read, edit, safe commands, all commands, browser, MCP, notifications); outside-workspace actions need a second toggle; YOLO approves everything with no confirmation | Granular consent. YOLO is the cautionary tale |
| Checkpoints       | After each tool use a bookmark row with Compare and Restore; Restore offers Files, Task only, or both                                                                               | Undo is first-class and always visible        |
| Cost and context  | Task header and TUI status bar always show tokens, cost, context fill                                                                                                               | Budget anxiety removed                        |
| Thinking row      | Collapsible, 250 ms ease transition (`ThinkingRow.tsx`)                                                                                                                             | Reasoning available, not imposed              |
| Large paste       | TUI collapses pastes of 5+ lines to a marker (`pasted-snippets.ts`)                                                                                                                 | Input stays usable                            |
| Desktop           | Workspace and branch picker, parallel sessions with separate context, schedules (one-time or recurring), import from other agents, marketplace, local-model memory chip             | Sessions as the unit, automations as a page   |
| Visual language   | VS Code theme variables, Tailwind 4, HeroUI, lucide icons, framer-motion (verified in `webview-ui/package.json`)                                                                    | Native to the editor, generic elsewhere       |

## Borrow

- A checkpoint row with Compare and Restore for each side effect Remy can reverse (its `reconcilable` tools).
- Plan versus Act as read-only versus acting, shown in the footer.
- Always-visible tokens, cost, context.
- An approval parameter list that shows exactly what will run.
- Desktop: a sessions list and a schedules page; import later.

## Do not borrow

- YOLO with no confirmation. Remy's `--auto <risks>` is scoped by risk and logged.
- Enter approves. A stray Enter must not approve a command; Remy uses explicit `y`.
- The component-kit look. Remy's identity is mono and paper/ink.
- A dense task header. Remy shows one line.

## Sources

- https://docs.cline.bot/getting-started/what-is-cline (2026-10-25)
- https://docs.cline.bot/features/auto-approve (2026-10-25)
- https://docs.cline.bot/features/checkpoints (2026-10-25)
- https://docs.cline.bot/core-workflows/plan-and-act (2026-10-25)
- https://docs.cline.bot/usage/cline-desktop (2026-10-25)
- https://cline.bot/ (2026-10-25)
- Source: the cline/cline repository at tag `desktop-v0.0.48` (`apps/cli/src/tui`, `apps/vscode/webview-ui`)

Not verified: the desktop app's layout (docs describe features, not panes; no screenshots read); task-header visuals (only component names read); Cline's exact colors and type.
