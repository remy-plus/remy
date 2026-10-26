# Claude Code: what is publicly known about its terminal UI

Claude Code is not open source. **Nothing here comes from its source or from the published npm bundle, which was not read, unpacked or deobfuscated.** Everything below is public information: official docs, the changelog, Anthropic engineers' public posts, and issues in the public anthropics/claude-code repository. Accessed 2026-10-25. Every row is therefore "public statement" or "inferred from behaviour", never "verified in source".

## Architecture as publicly described

- **Origin:** built with React rendered to the terminal via Ink; a secondary source dates the replacement of Ink with a custom renderer to v2.0.10 (October 2025). An engineer on the team described the current pipeline: build a React scene graph, lay it out, rasterize to a 2D screen, diff against the previous screen, emit ANSI, with a "~16ms frame budget" and about 5 ms for React to ANSI; "think of it as a small game engine". Screen buffers moved to packed typed arrays to avoid GC pauses. (HN comment by an engineer, https://news.ycombinator.com/item?id=46701013.)
- **Two render modes** (docs: Fullscreen rendering, a research preview):
  - _Classic:_ output goes to the terminal's native scrollback, so search, copy and tmux copy mode work. Changing content above the viewport means clearing and redrawing, which caused flicker. "There's no way to incrementally update scrollback in a terminal." Fix: synchronized output (DEC mode 2026), upstreamed to xterm.js and tmux; `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` forces it.
  - _Fullscreen:_ alternate screen buffer, input pinned to the bottom, only visible messages kept in the render tree (flat memory), mouse (click to expand tool results, select, click options), in-app scroll with Jump-to-bottom button and `Ctrl+O` transcript mode with `less`-style search, `[` to dump to native scrollback. Fullscreen is the default for new users as of 2026-05-06 (docs table); opt out with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`. A start that crashes falls back to classic automatically.
- **Screen reader mode** always uses plain scrolling text.

## Input and keys (docs: interactive mode, terminal config)

Enter submits; `Ctrl+J` or `\` + Enter newlines in every terminal; Shift+Enter where supported (`/terminal-setup` configures VS Code, Zed and others); vim mode; command history; large pastes (over 800 chars or 3 lines) collapse to `[Pasted text #1 +120 lines]`, stored under `~/.claude/paste-cache/` so recalled prompts resend the full text, and pasted text is flagged to the model as untrusted; `Ctrl+C` interrupts, then clears, then exits; `Ctrl+D` double-press exit; remappable keybindings file.

## Status, theming, notifications

- A user-defined status line runs a shell command fed JSON on stdin, rendered above the built-in footer.
- Themes: built-in presets plus an auto light/dark detector; custom themes are JSON files with a base and token overrides (`claude`, `text`, `inactive`, `permission`, `success`, `error`, `diffAdded`, `userMessageBackground`...). Spinner and key tokens have paired "shimmer" colors for an animated gradient.
- Terminal bell or desktop notification when Claude finishes or needs permission; OSC 7501 session-status protocol where the terminal supports it; tmux passthrough guidance.

## Sessions

Transcripts are stored on disk; a resumed session restores history; `/rewind` and checkpointing; background sessions and an agent view. (Docs: sessions, checkpointing, agent view.)

## Public versus inferred

| Claim                                                            | Basis                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| React-based, custom differential renderer, ~16 ms frame budget   | Engineer's public comment (HN)                                           |
| Alternate-screen fullscreen mode, mouse, transcript search       | Official docs                                                            |
| Synchronized output eliminates flicker in supporting terminals   | Engineer's public comment; docs                                          |
| Flicker reduced "by roughly 85%" by the rewrite                  | Anthropic engineer's post (secondary report; not independently verified) |
| Component system, internal file layout, streaming implementation | **Unknown**; not public                                                  |
| Spinner timing, animation internals                              | Unknown; the shimmer tokens suggest a colour sweep (inferred)            |

## Tradeoffs (as users report them)

- Native scrollback mode is familiar but flickers on large redraws; fullscreen is smooth but takes over scrolling, selection and search, so Anthropic had to rebuild all three in-app and still keeps an escape hatch (`[`) back to native scrollback.
- Mouse capture trades native selection for click targets; an env var disables it.
- A custom renderer costs a small team real engineering time (the issue tracker shows regressions such as scrollback loss in v2.1.89).

## Lessons for Remy

1. Stay in classic mode (native scrollback) and use synchronized output; it is a small change with most of the benefit.
2. Keep the escape hatch idea: a transcript view that can dump everything to native scrollback.
3. Collapse large pastes and store the full text, flagged as untrusted (fits Remy's tainting rule).
4. `Ctrl+C`: interrupt, then clear, then exit. Remy already does this.
5. Notify when waiting for the user; support a bell fallback.
6. Make tokens themed and overridable; never rely on hard-coded colours.

## Sources (accessed 2026-10-25)

- https://code.claude.com/docs/en/fullscreen
- https://code.claude.com/docs/en/terminal-config
- https://code.claude.com/docs/en/interactive-mode
- https://code.claude.com/docs/en/statusline
- https://news.ycombinator.com/item?id=46701013 (engineer's comment)
- https://github.com/anthropics/claude-code/issues/41965 (scrollback regression report)
- https://x.com/trq212/status/2001439019713073626 (announcement; seen only through a search result)
