# Stage 1 comparison

What the two X posts in the Road to 1.0 point at, and what Remy should take from them. Written 2026-11-05.

**How far this goes:** MausBot (OpenMausBot) was read from its source and docs at commit e5e155b. The four CopilotKit projects were read from their READMEs and repository layouts only. Nothing here was run, so anything about behaviour is what the project says about itself.

**The short version:** MausBot is the real target and is much broader than Remy: computers, 500+ apps, voice, phone apps, rooms of bots. Its thinking comes from Claude Code, Codex and Grok, so "smarter than MausBot" mostly means beating those agents with Remy's own loop. "10x" cannot be measured until both run the same tasks. Remy can lead on safe defaults, any model, cost and proof that work is done. Remy's largest gap is at the end of a task: nothing checks a claim before it says done.

## MausBot

Open-source desktop app (Apache 2.0, except `enterprise/`): a team of bots in a chat app. Version 0.1.142, about 5,000 TypeScript files and 2,407 test files. Bots run on the `claude`, `codex` and `grok` CLIs, or on custom engines and OpenAI-compatible endpoints. Paid cloud plans run from $15 to $99 a month, plus model costs. It is the project the Ideas card names; the CopilotKit post is a separate list.

**Take:**

- **Tests for choices.** `evals/tool-choice` scores which tool a model picks, and `evals/skill-bench` tests which skills trigger. Remy needs this: GPT-5 nano has never called `use_skill`.
- **Real runs become tests.** `evals/golden` redacts a real thread and replays it against a stored trace, so a real failure turns into a permanent test.
- **Saved steps.** A Mac task can replay without calling a model, which is cheap and steady. This fits the skill recorder idea in Stage 3.
- **A small model for small choices.** A fast classifier picks which bot should act, with a fallback when it is unsure.
- **Memory you can see.** Plain files, a gauge of what actually loads, a journal of every change with one-click undo, and credentials stripped before saving.
- **Sentinel.** A health scanner with no model calls that groups failures from logs into issues. It suits `remy doctor`.
- **A team from one Markdown file.** A good shape for role helpers.

**Remy is ahead on:**

- **Safe defaults.** MausBot starts each bot at Full access on personal installs, and its site says approvals depend on the engine and are not a guarantee. Remy asks by default and enforces it in code.
- **Its own loop.** MausBot hands the work to each engine, so its approvals, recovery and cost are partly out of its hands.
- **Measured work.** Its evals test the harness on six scripted scenarios and a smaller live tier. They do not score finished real tasks, and its own rule is to evaluate the harness, never the models.
- **Crash recovery.** Remy never repeats a side effect after a crash, tested at 100%.

**Behind on:** computers, the number of apps, voice, phones, rooms of bots, Windows, and a polished app. MausBot also connects to Boat for cloud computers, so Stage 4 has a working example to learn from.

**To settle 10x:** run the `hard` suite through MausBot on the same model as Remy. That needs a small adapter, so it waits until Stage 1 has a score worth comparing.

## OpenBot

Self-hosted agent platform for companies. A coworker gets its own browser, files and granted tools. Every action goes through one gateway that decides and records it. Needs Docker, PostgreSQL, Bun and a CopilotKit Intelligence project.

- **Remy already has:** one gate for every tool call (`AuthorizedCall`), with an event log of each step.
- **Take:** taking the wheel mid-task and handing it back. Remy can show its browser, but the flow is not designed around handing control back and forth.
- **Skip:** AG-UI and any-framework support. Remy is one agent, and that is the point of the single loop.

## OpenMuse

Personal agent with a browser, a terminal and work that keeps going, on phone and web. Durable tasks with SQL leases. Claims a verified list of what works, in `docs/VERIFICATION.md`.

- **Remy already has:** durable tasks, leases, pause and resume, approvals.
- **Take:** saved receipts for what a task did. Checks on public pages for changes or a price threshold, with no repeat alerts and a back-off on failure: Remy's watches cover files only. A public list of what is verified and what is not.
- **Later:** form filling from an email attachment through to a reviewed reply is a good hard eval once Remy can handle PDFs.

## OpenDots

Always-on coworkers with a name, a role and permitted tools, moving between web, mobile, Slack and calls, with saved pages in Spaces.

- **Remy already has:** read-only helpers, which are unproven live.
- **Take:** a helper defined by a name, instructions and an explicit list of tools. That is the shape Stage 2 role helpers need.
- **New for the board:** reaching Remy from Slack or text messages. No idea on the board covers this. Owner to decide if it belongs in 1.0.

## OpenDuet

Proactive agent built on OpenBot: a morning brief, sorting mail into what needs you and what can wait, and working while you are away.

- **Remy already has:** schedules, the daemon, once and always approvals. Remy keeps secrets out of chat and redacts them from output.
- **Take:** a morning brief built on schedules, listing what it could not check. A check on everything leaving the machine for card numbers or health details: Remy's redaction covers secrets, not personal data in an outgoing message. Labelled evals for judgement calls: its `evals/triage` measures mail sorting against a labelled set.

## The harness post

The post's claim: many agent failures come from the system around the model, not the model, so build that system and prove the work.

| Layer in the post                 | Remy today                                           | Gap                                                           |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Task contract                     | `update_plan` and open-step gating                   | No acceptance checks, and nothing lists what must not change  |
| Map, not manual                   | Top-matching skills, tool selection, situation block | Fine for now                                                  |
| Tool gateway                      | Risk, effect and policy on every call                | Tools return results, not evidence of what changed            |
| Brain, hands, history             | Event log and `nextAction(state)`                    | Fine for now                                                  |
| Durable state                     | Notes, summary, event log                            | Lessons from failures are not kept (Stage 3)                  |
| Completion needs evidence         | The model says it is finished                        | **Largest gap.** Nothing checks the claim                     |
| Verification attacks the result   | None                                                 | **Large gap.** No rejection step (Stage 2)                    |
| Model proposes, policy authorizes | Done, and tested at 100%                             | Remy leads here                                               |
| Recovery                          | Effect-based recovery, loop guard                    | No named failure classes in the log                           |
| Measure the system                | pass^k, cost, safety                                 | Not tracked: unsupported claims, human interventions per task |
| Build to delete                   | `remy eval compare`                                  | No test of what each layer adds when removed                  |

Taking this as a warning too: the post says complexity should be earned by observed failure. Each item below stays only if the hard suite rises.

## What this adds to Stage 2

1. **Evidence before finishing.** Before `finish`, compare the answer with what the tools returned: numbers and names need a source in the task's own log. Deterministic first.
2. **A verifier that tries to reject.** Fresh context, the request and the answer, permission to reject but not to repair. Only for tasks with several steps, and only if the hard suite rises.
3. **Receipts.** A short record at the end of a task, built from the event log rather than the model's words: what changed, what was verified, what was not.
4. **New metrics.** Count unsupported claims and human interventions per task in the eval report.
5. **Outgoing check.** Stop card numbers and similar details in outgoing messages unless approved.

6. **Choice benches.** Tool-choice and skill-trigger tests, so "skills that models actually use" has a number.
7. **Recovery by failure class.** A retry must change something, or Remy stops.

**For Stage 3:** real failures become replay cases, saved steps from the skill recorder, and a memory journal with undo.

**For Stage 4:** Boat as an optional cloud computer. See `design/research/boat-brand.md`.

For the owner: page watches, a morning brief and Slack or text access are not on the board yet.
