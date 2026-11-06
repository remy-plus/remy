# Stage 1 comparison

What the two X posts in the Road to 1.0 point at, and what Remy should take from them. Written 2026-11-05.

**How far this goes:** the four CopilotKit projects were read from their READMEs and repository layouts, not their source. Anything marked "claims" is what their README says, not something we ran. The name "MausBot" appears in none of them; the post lists OpenBot, OpenMuse, OpenDots and OpenDuet.

**The short version:** all four are beta or alpha templates you clone and rebuild. They show product surfaces well: a live computer view, cards in chat, a morning brief, messaging channels. None publishes a general score for finishing real work, so "10x better" has no number to beat. Remy's edge is the part they do not advertise: replay evals in CI and safety rules enforced in code. Remy's gaps are at the end of a task: proving the work is done, and showing what happened.

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
3. **Receipts.** A short record at the end of a task: what was read, what changed, what was asked.
4. **New metrics.** Count unsupported claims and human interventions per task in the eval report.
5. **Outgoing check.** Stop card numbers and similar details in outgoing messages unless approved.

For the owner: page watches, a morning brief and Slack or text access are not on the board yet.
