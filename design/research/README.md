# Design research

Reference study for Remy's interfaces, written 2026-10-25. Start with `remy-direction.md`, then `terminal-plan.md`.

| File                                  | What it holds                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `remy-direction.md`                   | Synthesis: prioritized changes for the terminal chat, and directions for desktop and mobile, with mockups and effort tags |
| `terminal-plan.md`                    | Implementation-ready plan for the terminal UI: phases, files, components, runtime hooks, tests, risks                     |
| `opencode-tui.md`                     | How OpenCode's terminal UI looks and behaves; borrow and avoid lists                                                      |
| `cline.md`                            | Cline in the editor, terminal and desktop; borrow and avoid lists                                                         |
| `claude-mobile.md`                    | Claude's mobile apps (weakest sourcing; visuals unverified)                                                               |
| `engineering/opencode.md`             | OpenCode TUI architecture from source (v1.19.4)                                                                           |
| `engineering/cline.md`                | Cline TUI and webview architecture from source (desktop-v0.0.48)                                                          |
| `engineering/claude-code.md`          | Claude Code from public information only (no source read)                                                                 |
| `engineering/claude-code-terminal.md` | Claude Code terminal UI as seen in the installed 2.1.312 bundle: renderer, pacing, input, prompts; ranked list for Remy   |
| `engineering/comparison.md`           | Side-by-side decisions and tradeoffs, including Remy today                                                                |

Conventions: "verified" means read in source or an official page; "inferred" means deduced and unconfirmed. Dates are access dates. No images or long passages are copied.
- [subscription-login.md](subscription-login.md): which providers allow signing in with a consumer subscription in a third-party app (only GitHub Copilot, through its SDK).
