# Terminal chat, 0.2 visual pass

Real screens from `apps/cli/scripts/pty-smoke.py --shot`: the chat runs in a pseudo-terminal, every byte is replayed into pyte, and the grid is painted with true colours and screenshotted by headless Chrome (2x). Font is the system mono (Menlo); the terminal background is the ink or paper of `branding/README.md`. Each run uses `REMY_KEYCHAIN=off`, a temporary `REMY_HOME` and `gpt-5-nano`.

| File                                                                          | Shows                                                                                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `chat-dark-100x32.png`, `chat-light-100x32.png`                               | Welcome, turns, markdown (heading rule, nested bullets, inline code, code block with label, table), paste, plan, resume |
| `approval-dark-100x32.png`, `approval-light-100x32.png`                       | Tool rows (time at the right, failure in clay), approval card with a tinted diff line                                   |
| `working-dark-100x32.png`                                                     | Thinking row, docked prompt, footer while Remy works                                                                    |
| `resume-dark-100x32.png`                                                      | `/resume` panel                                                                                                         |
| `first-run-*`, `slash-dark-100x32.png`, `palette-dark-100x32.png`, `models-*` | Login panel, `/` list, Ctrl+P filter, model list with aligned details                                                   |
| `chat-dark-80x24.png`, `chat-light-80x24.png`                                 | The same at 80 columns                                                                                                  |

Craft learned from OpenCode v1.19.4 (`packages/tui`: inline tool rows with a glyph column and a block only for edits, `~` for pending, strike-through for denied, a spinner at 80 ms) and Cline desktop-v0.0.48 (`apps/cli/src/tui`: a status bar with figures, dimmed thinking, a rounded gray autocomplete). Nothing of their branding or layout is used.
