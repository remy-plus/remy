# Changelog

## 0.3.0 (2026-10-27)

Remy takes the whole window: a calm, centered home, a conversation that scrolls inside the screen, and an input box that stays put.

- **Full screen by default.** Remy opens on its own screen and gives your terminal back exactly as it was when you quit. Redraws touch only what changed, about 3.5 times less output per streamed word than 0.2, with no flicker.
- **Home.** The wordmark, the input box and one useful tip, centered; the conversation starts when you send your first message, and `/new` brings you back.
- **The conversation.** Your messages sit in a quiet panel, replies end with the model and how long the turn took, and tool rows stay on one line unless an edit or a command has something worth showing. PgUp and PgDn scroll, Home and End jump, and new text never pulls you down while you read further up. Approvals and questions take the place of the input box.
- **Dialogs.** The command palette (`Ctrl+P`), `/model`, `/sessions` and `/login` open as centered panels you can search as you type.
- **Sidebar.** On terminals wider than 120 columns: the session title, context and spend, the plan, and the files Remy touched. `Ctrl+B` shows or hides it.
- **Input that feels right.** A real cursor, word moves and deletes (Option or Alt with the arrows, Alt+B, Alt+F, Alt+D, Ctrl+W), cut and paste back (Ctrl+K, Ctrl+U, Ctrl+Y), undo and redo (Ctrl+Z, Alt+Z), `Ctrl+R` to search what you sent before, and pastes of 3 lines or more shown as `[Pasted ~N lines]`.
- **Motion with restraint.** A quiet sweep while Remy works, a timer that ticks once a second, and soft fades; all of it stops when you ask for reduced motion.
- **Themes.** `/theme` picks auto, light or dark, applied at once and remembered; `/light`, `/dark`, `/day` and `/night` are shortcuts.
- **Minimal mode.** `remy --minimal` (or `/minimal`, remembered) keeps Remy inline in your terminal with native scrollback and search: one header line, one quiet status line, your messages and the replies. `--classic` still works for now.
- **Steadier streaming.** Text arrives once per frame instead of once per fragment, and nothing is lost or reordered.
- Screens: `design/screens/0.3/`.

## 0.2.0 (2026-10-27)

The terminal grows up: Remy narrates what it is doing, asks better questions, and treats what you paste with care.

- **Narration and meters.** One calm status line says what Remy is doing ("Grouping 212 files · step 3 of 4 · 12s"); the footer shows context used and the task's spend against its budget.
- **Approval card v2.** The exact action, whether it can be undone, and a short code for that one approval. `y` approves once, `n` denies, `e` denies with a note Remy reads; Enter never approves, and a new card ignores keys for half a second so type-ahead cannot answer it. `remy approve <id> --deny --note "..."` does the same from scripts.
- **Transcript view.** Tool lines keep their details; `Ctrl+O` opens the whole conversation, searchable with `/`, and `[` copies it to your scrollback.
- **Better input.** Multi-line messages (`Ctrl+J` or `\` then Enter), word and line editing, and long pastes shown as `[Pasted N lines]`. `REMY_INPUT=single` keeps the old one-line editor.
- **Pasted text is untrusted.** A paste in a message or an answer marks the task, so every action after it needs your approval, and Remy reads the paste as data, not instructions.
- **Sessions.** `/resume` picks an unfinished task and says where it left off. Providers that stream reasoning summaries get a short "Thinking: ..." line.
- **Terminal manners.** Flicker-free redraws where the terminal supports them, a bell when Remy waits and the window is unfocused (`REMY_NOTIFY=off`), light and dark detection, and stray output kept out of the layout.
- **Patience with rate limits.** A 429 waits as long as the provider asks (up to a minute) and gets more attempts, so free tiers work.
- **Groq.** `REMY_PROFILE=groq` with `GROQ_API_KEY`.
- **`remy login`.** Pick a provider, paste the key (hidden), optionally name a default model; Remy checks the key and saves it in the macOS Keychain or a private file in `~/.remy`. `remy login --list`, `remy logout <provider>`, and `remy login <provider> --key-stdin` for scripts. Flags beat env, env beats a saved login, a saved login beats `remy.config.json`.
- **Anthropic and Google Gemini.** Native API profiles (`anthropic`, `google`) with Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 and 4.5, and Gemini 2.5 Pro, Flash and Flash-Lite priced in the catalog. Groq's key is now redacted from logs like the others.
- **Easy from the first run.** With nothing connected, `remy` opens a login panel instead of exiting. In the chat: `/model` switches the model, `/login` connects a provider, `/sessions` picks up a task, `Ctrl+P` lists every command, typing `/` suggests commands, and `@path` hands Remy a workspace file (as untrusted context). Errors end with the one next step.
- **A quieter, sharper look.** Even rhythm between turns, aligned tool rows with timings at the edge, approval cards with coloured diffs, real Markdown (labelled code blocks, tables, nested lists), a calm spinner, a welcome screen with examples, and matched letters underlined in every picker. Light terminals and `NO_COLOR` look right too. Screens: `design/screens/0.2/`.
- **New tagline:** "Your assistant, anywhere."

## 0.1.0 (2026-10-26)

First usable release: the terminal chat, file, web, math and command tools, approvals bound to each action, crash-safe resume, and the eval suite. See the [release](https://github.com/remy-plus/remy/releases/tag/v0.1.0).
