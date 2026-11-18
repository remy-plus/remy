# inimitable: approved decisions

Only what the owner has approved goes in `SKILL.md`, and `SKILL.md` is written only from this file.
An item is proposed in chat, approved by the owner, then added here with its date and source.
Nothing here is a draft.

## Approved

| # | Decision | Source | Approved |
|---|---|---|---|
| 1 | The skill is global (`~/.claude/skills/inimitable/`), not tied to one project. It keeps improving as more projects are built. | owner | 2026-11-16 |
| 2 | Name: `inimitable`. | owner | 2026-11-16 |
| 3 | Backbone: one fixed run for any request. The skill detects whether the job is new or a fix of an existing screen, and branches. Not a set of commands. | owner | 2026-11-16 |
| 4 | Sources: impeccable (impeccable.style), tasteskill (tasteskill.dev) and unslop (github.com/heydamir/unslop) are built on item by item. Each idea is proposed in chat with its source named and goes in only after approval. | owner | 2026-11-16 |
| 5 | Surfaces covered from the start: web apps and dashboards, landing and marketing pages, terminal UI, native mobile. | owner | 2026-11-16 |
| 6 | The one-shot bar: it looks right on first show. The skill renders the real screen, checks it at phone and desktop sizes, and fixes what it finds before showing the owner. The owner should only need to give taste feedback. | owner | 2026-11-16 |
| 7 | Approvals are tracked in this file. | owner | 2026-11-16 |
| 8 | The skill is extremely in-depth and practical, and good at one-shotting. | owner | 2026-11-16 |
| 9 | The run has nine steps, in this order: 1 Read (the brief, the project's own design rules and tokens, and the existing screens running in a real browser). 2 Decide the mode (persuade, operate, read or experience; from impeccable). 3 Fix the direction (one sentence on what it should feel like and what it must not look like). 4 Branch: an existing screen is fixed layer by layer (spacing, colour, icons, copy, type, layout, details, motion; from unslop), a new screen is built around one bright element (from tasteskill). 5 Build. 6 Gate (run the checks). 7 Look (render at phone and desktop sizes and fix what shows). 8 Report (short summary, before and after). 9 Log (record what was learned). Each step is deepened one at a time, with approval. | owner | 2026-11-16 |
| 10 | The project's own design rules win over the skill's taste (brand guide, tokens, checklists). Where a project has none, the skill proposes rules and the owner approves them. | owner | 2026-11-16 |

## Licences (facts, not decisions)

- unslop: CC BY 4.0, by Damir Sokolovsky (@heydamir). Any adaptation must keep that credit.
- impeccable and tasteskill: no licence file in the installed copies. Restate ideas in our own words and name the source. Do not copy wording until terms are confirmed.

## Open

Not yet decided: the steps of the run, house rules, anti-slop list, per-surface rules, verification method, scripts, how lessons are logged after each project.
