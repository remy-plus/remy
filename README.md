<picture>
  <source media="(prefers-color-scheme: dark)" srcset="branding/logo/remy-wordmark-on-dark.svg">
  <img alt="Remy" src="branding/logo/remy-wordmark-on-light.svg" width="360">
</picture>

**Your assistant, anywhere.**

Remy is an open-source AI agent that completes digital tasks through plain conversation. You say what you need, it does the work, and it asks before anything that sends as you, spends money, or can't be undone.

> Status: Phase 0, an early prototype. Remy runs from the command line and does research, web reading and file work. The web app, integrations and browser automation are on the [roadmap](PLAN.md#product-roadmap-after-phase-0).

## What makes it different

- **Any model.** Use OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Ollama, or any OpenAI-compatible endpoint, including free open-weight models. Weaker models get a constrained JSON mode.
- **Safety enforced in code, not prompts.** Every tool call goes through a policy engine. After Remy reads anything untrusted (a web page, an email), every action beyond reading needs your approval. An approval covers the exact action you saw, once.
- **Survives crashes without repeating itself.** Every step is an event in a log. Kill the process at any point and `remy resume` picks up where it left off. An action that might already have happened is never re-run without asking.
- **Measured.** An eval suite tracks success, reliability, cost, latency, safety violations and duplicate actions. Changes that regress it are blocked.

## Quick start

Requires Node 22.18+ and pnpm (via `corepack enable`).

```sh
git clone https://github.com/remy-plus/remy.git && cd remy
pnpm install

# Connect a model once: pick a provider, paste the key, done
pnpm remy login

pnpm remy
```

### Models

`remy login` stores your key in the macOS Keychain, or in a private file in `~/.remy` (mode 0600) elsewhere. `remy login --list` shows what is saved (never the keys), `remy logout <provider>` forgets one, and `echo $KEY | remy login openai --key-stdin` works without a terminal.

| Provider      | Profile            | Key variable         | Notes                                                        |
| ------------- | ------------------ | -------------------- | ------------------------------------------------------------ |
| OpenAI        | `openai`           | `OPENAI_API_KEY`     | OpenAI-compatible API                                        |
| OpenRouter    | `openrouter`       | `OPENROUTER_API_KEY` | Many models, some free                                       |
| Groq          | `groq`             | `GROQ_API_KEY`       | OpenAI-compatible API                                        |
| Anthropic     | `anthropic`        | `ANTHROPIC_API_KEY`  | Native Messages API                                          |
| Google Gemini | `google`           | `GEMINI_API_KEY`     | Native Gemini API                                            |
| Ollama        | `ollama`           | none                 | Local models                                                 |
| Anything else | `--base-url <url>` | `REMY_API_KEY`       | Any OpenAI-compatible endpoint (or `custom` in `remy login`) |

Settings are resolved per field: flags, then environment variables, then a saved login, then `remy.config.json`. Without a login, set `REMY_PROFILE`, `REMY_MODEL` and the key variable instead, for example `REMY_PROFILE=anthropic REMY_MODEL=claude-sonnet-5-5 ANTHROPIC_API_KEY=...`. Prices and context windows for common models (Claude Opus, Sonnet and Haiku, Gemini 2.5 Pro, Flash and Flash-Lite, GPT-5 nano, Llama 3.3 on Groq) are built in; other ids work and are shown with unknown cost, or you can list them in a `models.json`.

Plain `remy` in a terminal opens the chat full screen, on a calm home screen with the input box centered: type a message, and each one carries the earlier ones as context. Replies stream in, tool calls show as they run, and Remy asks for a `y` or `n` before anything that needs approval. PgUp and PgDn scroll the conversation, Ctrl+B shows the sidebar on wide terminals, and Ctrl+R searches what you sent before. Ctrl+C stops a running task (resume it with `remy resume <id>`), Ctrl+D quits. Type `/` for commands as you type (`/model` switches the model, `/login` connects a provider, `/sessions` picks up an unfinished task), press Ctrl+P for the command palette, and type `@` to attach a file from the workspace. With nothing connected yet, `remy` opens on the login panel. `/help` lists the rest. `/theme auto|light|dark` (or `/day`, `/night`) switches the colors at once and remembers the choice. `remy --minimal` opens a quieter scrolling chat with no header art, and `/minimal` makes it the default. Use `--reduced-motion` to turn off animation and `NO_COLOR=1` to turn off color. For scripts, run one task directly:

```sh
pnpm remy run "Summarize https://example.com in three bullet points"
```

Useful commands: `remy list`, `remy show <id>` (the full timeline), `remy resume <id>`, `remy approve <id> [--deny]`, `remy cancel <id>`. Add `--debug` to any command to log model requests, responses and events as JSON lines (to stderr, or to `~/.remy/debug-<time>.jsonl` in the chat). Web search is enabled when `BRAVE_API_KEY`, `TAVILY_API_KEY` or `SEARXNG_URL` is set.

## Install

Node 22.18 or newer:

```sh
npm install -g @koryei/remy
```

From a clone instead: `pnpm install && pnpm bundle && npm install -g ./apps/cli`.

See [CAPABILITIES.md](CAPABILITIES.md) for what Remy can and cannot do yet.

## Development

```sh
pnpm check         # lint, typecheck, build, tests
pnpm eval:replay   # deterministic eval run (the CI gate)
pnpm eval --profile openrouter --model <id> --k 3   # live eval
```

The architecture, the reasoning behind it and the roadmap are in [PLAN.md](PLAN.md). Packages:

| Package           | What it does                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `packages/core`   | Events, reducer, `nextAction`, runner, policy engine. Depends only on interfaces |
| `packages/store`  | Event store: in-memory and SQLite                                                |
| `packages/models` | OpenAI-compatible client, native and JSON tool-calling strategies, record/replay |
| `packages/tools`  | Built-in tools behind a jailed filesystem and an SSRF-guarded network            |
| `packages/evals`  | Eval cases, mock world, graders, metrics, regression compare                     |
| `apps/cli`        | The `remy` command                                                               |

## License

[Apache-2.0](LICENSE). The Remy name and logo are not covered by the license; see [branding/README.md](branding/README.md).
