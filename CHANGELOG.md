# Changelog

## Unreleased

- **Trust levels.** `/trust` in the chat and `remy trust <ask|steady|away>` choose how much Remy does without a card. `steady` goes ahead with writing, editing and moving files and making folders in the workspace, saving notes and adding a schedule. `away` adds saving a skill and is meant for long runs while you are gone. At every level, spending, sending or posting as you, deleting, running commands and anything after untrusted content still ask, a blocked tool stays blocked, a connected app follows `/approvals` only, and helpers never get the level. The level shows in the status row and the capabilities list, and a task keeps the one it started with, also after a crash. When a trusted write replaces an existing file, the old version is kept beside it as `<name>.before-remy` (then `-2`, `-3`) and Remy tells you where.
- **At `away`, a card no longer stops the task.** The action waits, unrun, while Remy carries on with the parts of the task that do not depend on it, and it is told plainly which actions wait. Up to three cards wait at once; the fourth stops the task as before. A waiting action runs only when you approve those exact arguments, once; if you decline, it is recorded as declined and Remy says so. A task never ends as done with a card still waiting: it pauses with a summary of what is done and what waits, and resumes when you answer the last card. Spending, sending as you, deleting, running commands, untrusted content and helpers still need the card, and a restart with cards waiting brings back the same cards without running anything twice. Background tasks send a notification when the first card waits. Other levels behave as before.
- **`remy run --for 3h`.** One flag sets the clock, steps and cost for a long job together (50 steps and $1.25 an hour, up to 24 hours) and prints the most it can spend before it starts. `--max-steps` and `--max-cost` still win. A task that runs out pauses, as before.
- **Helper roles from one Markdown file.** `helpers.md` in your Remy folder, or in `.remy/` in a project (the project wins by name), holds one `## name` section per role: an optional `Tools:` line, an optional `Act:` line and the instructions. `delegate` takes a role name and the helper gets those instructions and only those tools. A role can narrow what a helper may use and never widen it or lift a deny. Two roles come built in: `researcher` and `checker`, which reads a draft and finds what is wrong or unsupported. A role from a project folder starts the helper tainted, like a skill from a link. Mistakes in the file show up in `remy doctor` with a line number and never stop Remy.
- **Helpers that can act, with your approval.** `REMY_HELPERS=act` lets a helper whose role says `Act: yes` ask to change things. Each change reaches you as an approval card on the task you are in, marked with the helper that asks, bound to the exact arguments and good once. A helper never inherits your always-allow, never approves for itself, and one that read an untrusted page needs approval for every change. Only one acting helper runs per `delegate` call. If you say no, the change is not made and the answer says so. `REMY_HELPERS=on` stays read-only.
- **A helper cut off mid-action is not repeated.** After a crash, a helper in the middle of a call that cannot be safely repeated ends it as unknown and says so, instead of running it again.
- **Remy knows what it can do here.** Each message now carries a short list of what works on this machine (web search, browser, files, schedules, helpers, skills) and, for each gap, the one step you take to fix it. Asked for something it cannot do, such as email with nothing connected, Remy says what is missing and the exact step, instead of trying and failing or claiming it. It reads the same checks as `remy doctor`, once per session.
- **Sources are checked.** After reading web pages, an answer with a link nobody read, or with no link to a page that was read, goes back once. So does a latest version, a price or today's status seen on only one site: Remy confirms it on a second site and says so if they disagree. It is one push back per task and never a failure.
- **Better first picks.** Tool and skill descriptions now say when to hand work to helpers (three or more separate lookups), that checking a claim is research, and that a plain article is read with `fetch_url` before the browser.

## 0.10.1 (2026-11-06)

Remy no longer reports work that did not happen.

- **Claimed work is checked.** If a model says it sent, saved or finished something and no tool did it, the reply goes back with word that nothing happened. A repeat ends the task with "Nothing was done." instead of a success. This holds for plain replies and for `finish`, and when an action was refused or failed.
- **A promise is not an answer.** "Let's start by reading the file" with no tool call goes back to do the work.
- **Groq is steadier.** `gpt-oss` models now get room to reason, malformed replies are tried again, and retries raise the temperature so the same bad reply is not repeated. Over-capacity errors wait like rate limits.
- **Llama 3 on Ollama works**, through JSON tool calls.
- **12 more providers in `/login` and `/model`:** DeepSeek, Mistral, xAI Grok, Together AI, Fireworks AI, Cerebras, Nebius, Moonshot Kimi, Z.ai GLM, DeepInfra, Alibaba Qwen and Inception Mercury.
- **An unknown outcome is not repeated.** If a server goes away mid-action, Remy will not send it again, and the model is told to say it may or may not have happened.
- Groq now starts on a model it still serves, and a bad xAI key is refused instead of saved.
- **TinyFish search.** `REMY_SEARCH=tinyfish` with a free `TINYFISH_API_KEY`: 30 searches a minute, nothing on screen.
- A used-up daily limit now says so at once, and when it lifts, instead of retrying for minutes.

## 0.10.0 (2026-11-04)

Remy can start work by itself, on your schedule.

- **Schedules.** `remy schedule add "every day at 9" "<prompt>"`, or just ask in the chat. Weekdays, intervals and "when ~/Downloads changes" work too. `/schedules` shows them.
- **It still asks.** Setting up a schedule goes through an approval card, and each run asks before it acts. A page cannot set one up.
- **A small daemon.** `remy daemon install` starts it when you log in on macOS. A missed run happens once when your Mac wakes, and a crash never repeats a run.
- **Notifications** when a scheduled task finishes or needs you.
- **`remy doctor`** shows what is set up and the next step for each.
- **Container search stays on.** `remy browser vm start` now turns it on for good, and it restarts by itself after a reboot. `remy browser vm stop` turns it off.
- Web answers end with the links of the pages Remy read.
- Fixed: a greeting that ends in a question mark no longer pauses the task.

## 0.9.0 (2026-11-04)

Remy learns how you work, and search no longer has to fight the search engines.

- **Skills.** Short how-tos Remy follows for kinds of tasks, in the Agent Skills format. Built in: research, compare-and-buy, write-and-send, triage-issues and save-to-notion. `remy skills`, `/skills`.
- **Skills from a link.** `remy skills add <link>` takes a GitHub repository, folder or file, or any public `https` link. It shows the whole text first and saves only that text, pinned to its commit on GitHub. `remy skills update <name>` shows new text before using it. Only you can add a skill; nothing on a page can.
- **Skills from outside stay limited.** The model sees only the name until it reads one, and reading one means any action needs your approval.
- **Remy offers to save what worked.** After a long task it can save the steps as a skill of yours, with a card showing the full text.
- **Skills can name a connection.** When one is missing, Remy tells you to run `/connect`. It never connects anything by itself.
- **Search in a container (optional).** `remy browser vm start`, then `REMY_SEARCH=vm`. A real Chromium with a virtual display runs in Docker or Colima, so search engines accept it and nothing appears on your screen. It holds none of your files or sign-ins. Needs about 2 GB of download and a few GB of memory.
- **Helpers (optional).** `REMY_HELPERS=on` lets Remy hand separate parts of a task to up to 3 read-only helpers working at once. They share the task's budget, cannot change anything, and a crash picks up the same helpers instead of starting more.
- Fixed: a broken web address no longer crashes Remy.
- Includes every fix from 0.8.1.

## 0.8.1 (2026-11-04)

Search gives you real pages or says it found nothing.

- **Search skips pages that miss the question.** Bing sometimes reads only one word of a query, so Remy now drops off-topic results, tries the query another way, then tries DuckDuckGo.
- **Fewer wasted steps.** When a search finds nothing, Remy stops and says so instead of repeating it or answering from memory.
- **Remy waits for you when it needs an answer.** A long reply that hands the work back with questions now pauses the task instead of counting as finished.
- **Stopping works.** `kill` ends a running task instead of restarting its browser.
- Fixed: a redirect during a search, or a failed DuckDuckGo fallback, no longer fails the search.
- Known limit: some topics still return nothing, because the search engine reads only part of the query.

## 0.8.0 (2026-10-29)

Remy uses the computer it runs on to find things.

- **Its own browser.** Remy searches and reads the web in a hidden Chrome (or Edge, or Chromium) on your machine, with its own profile in `~/.remy/browser`, instead of guessing page addresses. Nothing to sign up for. It can open pages, follow links, use a site's search box and fill in fields.
- **It asks before it acts.** Pressing a button that sends, posts, saves or deletes something asks you first, and a button that pays asks every time, as a payment, with one card. Remy never types passwords or card numbers: it shows the window and you do that part. A plain click cannot press "Buy now".
- **The sidebar shows the browser:** whether its window is shown and which page it is on.
- **Sign in once.** `remy browser show` (or `/browser` in the chat) opens the window so you can sign in to sites; Remy keeps those sign-ins. `remy browser reset` signs out of everything; `remy browser install` gets Chromium for machines without Chrome or Edge.
- **Pick your search.** `REMY_SEARCH` (or `"search"` in `remy.config.json`) chooses `browser`, `context` ([Context.dev](https://context.dev)), `brave`, `tavily`, `searxng` or `off`. Without a pick, a service whose key is set does the searching (`CONTEXT_DEV_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL`), otherwise Remy's browser. Don't want Remy using your computer? `REMY_BROWSER=off` with a search service.
- Local addresses stay blocked unless `REMY_BROWSER_LOCAL=on`, and `--net-allow` limits the browser too.
- Fixed: a mistyped OpenRouter key is refused at login instead of saved as connected.
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
