# Changelog

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
- **New tagline:** "Your assistant, anywhere."

## 0.1.0 (2026-10-26)

First usable release: the terminal chat, file, web, math and command tools, approvals bound to each action, crash-safe resume, and the eval suite. See the [release](https://github.com/remy-plus/remy/releases/tag/v0.1.0).
