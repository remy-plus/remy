# What Remy can do (v0.1.0)

Remy is a terminal agent. You describe a task, and it works in small steps with the tools below until the task is done, it needs you, or it hits a limit. Everything here is tested in `pnpm check` and the eval suites (34 cases).

## Works today

**Chat.** Run `remy` in a terminal to open the chat. Replies stream as they arrive, and each tool call shows its status as it runs. Multi-step tasks show a plan. Earlier turns carry into the next task: the last 10 turns, or about 8,000 characters. `remy run "<prompt>"` runs a single task, for scripts and pipes.

**Files**, inside one workspace folder (by default `~/.remy/workspaces/<task id>`, or the folder you pass with `--workspace`):
- read and list files
- write files
- make exact in-place edits
- move files and create folders
- delete files

**Web:**
- fetch a page
- search the web, if you set `BRAVE_API_KEY`, `TAVILY_API_KEY` or `SEARXNG_URL`
- restrict browsing to the domains you pass with `--net-allow`

**Commands.** `run_command` runs one program from an allowlist: `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `find`, `git`, `node`, `npm`, `pnpm` and `python3`. There are no pipes, redirects or wildcards. Each command runs in the workspace with a minimal environment, a 30-second timeout and capped output, and **every command needs your approval**.

**Math.** `calculate` does arithmetic and date math, such as the days between two dates or adding days to a date.

**Questions.** When Remy needs something only you know, it asks, at most 3 times per task. In the chat you answer in the input box; otherwise use `remy answer <id> "..."`.

**Models.** Remy works with any OpenAI-compatible endpoint: OpenAI, OpenRouter, Ollama, vLLM or Groq. Set `REMY_PROFILE`, `REMY_MODEL` and that provider's API key.

## Safety

- **Approvals.** By default Remy only reads without asking. Writing files needs your yes unless you allow it with `--auto read,write`. Deleting files, running commands, sending as you and spending money always ask, whatever `--auto` says. Each approval covers one exact action and is used once.
- **Untrusted content.** Text from web pages, emails and command output is marked untrusted. Once a task has seen it, every action that is not a read needs your approval, so instructions hidden in a page cannot act on your behalf.
- **Containment.** Tools only reach the workspace folder and the network through scoped access. Secrets are kept out of what the model sees.
- **No double actions.** Every task is an append-only event log. If Remy crashes or you press Ctrl+C, `remy resume <id>` continues from where it stopped. An action that may already have happened is checked or reported, never blindly repeated.
- **Limits.** Each task stops at 30 steps, $1 of model cost or 30 minutes, whichever comes first. Use `--max-steps` and `--max-cost` to change the first two.

## Measured

On GPT-5 nano, the 30 cases that existed then passed at 100% across 150 runs (run 7, 2026-10-26), with 0 safety violations and 0 duplicate actions. That cost about $0.0005 per task. Full history is in `evals/results/`.

## Not yet

- No browser automation: it reads pages but cannot click or fill forms.
- No real email, calendar or other account integrations. Those tools exist only in the eval world.
- Ctrl+C stops the task, but a tool that is already running finishes its current call.
- `run_command`'s path check is lexical: it does not follow symlinks inside the workspace. Approval is the real guard.
- `run_command` is not a full sandbox. `node`, `python3` and `git` can do anything you could do in the workspace, so read the command before you approve it.
- No memory across chats beyond the current conversation, no scheduled tasks and no voice.
- Weaker or free models are less reliable than the numbers above. Open-weight baselines are still to be measured.
