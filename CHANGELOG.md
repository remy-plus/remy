# Changelog

## Unreleased (0.8)

Remy uses the computer it runs on to find things.

- **Its own browser.** Remy searches and reads the web in a hidden Chrome (or Edge, or Chromium) on your machine, with its own profile in `~/.remy/browser`, instead of guessing page addresses. Nothing to sign up for. It can open pages, follow links, use a site's search box and fill in fields.
- **It asks before it acts.** Pressing a button that sends, posts, saves or deletes something asks you first, and paying asks every time. Remy never types passwords or card numbers: it shows the window and you do that part. A plain click cannot press "Buy now".
- **Sign in once.** `remy browser show` (or `/browser` in the chat) opens the window so you can sign in to sites; Remy keeps those sign-ins. `remy browser reset` signs out of everything; `remy browser install` gets Chromium for machines without Chrome or Edge.
- `REMY_BROWSER=off` turns the browser off. Local addresses stay blocked unless `REMY_BROWSER_LOCAL=on`, and `--net-allow` limits the browser too. A Brave, Tavily or SearXNG key still does the searching when set.
- Remy no longer asks for keys or passwords in the chat, and never says it set something up unless a tool did it.

## 0.7.0 (2026-10-28)

Remy costs less to run and keeps one conversation going.

- **Prompt caching that works.** Providers bill input they have seen before at a half or a tenth of the price, but only when each request starts exactly like the last. Remy now keeps that start fixed: memory notes no longer change the system prompt, the tools offered only grow during a task, older tool results are shortened once instead of a little on every step, and earlier chat turns drop in blocks. Claude models get the cache markers Anthropic needs, directly and through OpenRouter.
- **One conversation.** `remy` opens where you left off, with your last few exchanges and the same folder of files. Older turns fold into a short running summary instead of being forgotten. `/new` (or `remy --new`) starts fresh.
- **Remy knows the moment.** Each message carries the local date and time, your background tasks and your connected apps, so "what's running?" or "what day is it?" needs no lookup.
- **Remy remembers what you did together.** A new `recall` tool searches all your notes and your past tasks, so "when was that invoice due?" finds last week's answer. Several notes can be saved with one approval.
- **See the savings.** `remy show` and the sidebar show how much of the input came from the cache, and cached input is priced at its real rate.
- **Faster.** Reasoning models such as GPT-5 nano think at low effort by default, so steps take seconds instead of half a minute (`REMY_REASONING=minimal|low|medium|high` changes it). Typing in the full screen reaches the screen in about 12 ms instead of 43.
- **Finishes what it starts.** A task that stops to ask "shall I go on?" with its plan unfinished is sent back to work once. Remy no longer asks to confirm what you already said, and checks a source before saying a new product does not exist.
- **Reads big pages.** Pages over 2 MB (most news and review sites) are read up to 2 MB instead of refused. Without web search, Remy no longer guesses page addresses.

## 0.6.0 (2026-10-28)

Remy keeps going on big jobs, works while you are away, and remembers what you tell it.

- **Long runs pause instead of failing.** A task that reaches its step, cost or time limit stops with "Paused after 30 steps and $0.42. Continue for 30 more steps?" Answer y or n, or later with `remy continue <id>`. `--long` gives a task 200 steps, $5 and four hours. Progress notes every 10 steps, and Remy finishes or skips (with a reason) every step of its plan before it says it is done.
- **Background tasks.** `remy run --background "<task>"` or `/bg <task>` starts a task and hands your terminal back. `remy list` shows where each one is, `remy attach <id>` follows one live and answers its questions there, and a macOS notification says when it finishes or needs you (`REMY_NOTIFY=off` turns them off).
- **Memory.** With personalise on in your profile, Remy can save short notes about you (preferences, facts, how you like things done), always with your approval, and uses the five most relevant in each task. `/memory` and `remy memory` show, edit and forget them. A web page cannot save a note on its own.
- Fixed: `remy list` no longer fails with "database is locked" while another Remy process is writing.

## 0.5.0 (2026-10-28, published as part of 0.6.0)

Remy connects to your apps.

- **Connections through MCP.** `remy connect` (or `/connect`) offers GitHub, Notion, Linear, Sentry, a folder of files, memory and web pages, and asks only for what each needs: a browser sign-in, a token or a folder. `remy connect add` adds any other server, local or remote, and `remy connect --import` brings in the ones Claude Desktop or Claude Code already use. Tokens stay in the Keychain.
- **`/connections`.** Every server with its status and tool count; turn one off, sign in again, or remove it.
- **The right tools for each step.** With many tools connected, each step offers the model the 12 most relevant, and it can search for the rest.
- **Always allow.** `a` on an approval card lets one tool write or send without asking from then on, never for deletes or payments, and never in a task that has seen untrusted content. `/approvals` and `remy approvals` list and undo them.
- **Safe by default.** A connection's tool asks before it acts unless its server is on the built-in list and marks it read-only. What a connection returns is untrusted. A server that fails mid-action is never retried blindly. A new `connections` eval suite (17 cases) holds all of this at 100%.

## 0.4.1 (2026-10-28)

Typing stays instant while Remy streams, and you can cut in.

- **Instant keys.** Right after a keypress, the screen redraws every 4 ms instead of every 16, so what you type and the cursor show up at once, even mid-reply.
- **Steady on slow links.** When the terminal falls behind (over SSH, for example), Remy waits for it to catch up and then draws the latest state, instead of piling up frames.
- **Send now.** While Remy works, Enter still queues your message; **Ctrl+S** (or Alt+Enter) stops the current turn and sends it straight away. Messages already queued run after it, and the stopped task stays resumable.

## 0.4.0 (2026-10-28)

Remy gets to know you in two minutes, then greets you by name.

- **A welcome tour on first run.** A calm welcome screen, then what to call you and what you mostly want help with (pick several or type your own), your provider and model (skipped when one is connected, with a cheap default highlighted), and a real first task chosen from your answers. Esc skips the rest at any step.
- **A real first task.** Research, files, coding, work and email, or school: Remy runs a small task for real with your model in a scratch folder, in the normal session view, asking before it moves anything. You can pass it over.
- **Three keys to remember**, then the home screen: `Good evening, Sam.`, example requests and tips that match your goals.
- **A small local profile.** `REMY_HOME/profile.json` (owner-only) holds your name and goals. It is never logged and goes nowhere except, if you agreed, as one line of context to your own model.
- **`/profile`** shows and edits it: name, goals, personalise on or off, delete. **`/tour`** replays the tour.
- **Minimal mode** has the same steps as plain text.
- Screens: `design/screens/0.4/`.

Steadier on small and free models:

- **Long pages fit.** Fetched pages are capped at 6,000 characters, and what Remy sends the model stays inside its context and per-minute token limits (Groq's free tier included). If a provider still says a request is too large, Remy halves it and tries once more.
- **Plain errors.** Provider errors read as one sentence with the next step, never raw JSON.
- **Fewer questions.** When a site can't be read, Remy tries other sources before asking you, and says what it couldn't reach.
- **Plans that stop say so.** Steps left unfinished when a turn ends show as stopped, not in progress.

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
