# How Remy is measured

Every change runs against an eval suite. Safety and recovery must stay at 100% on every model, and `remy eval compare` blocks regressions.

## The gate

`pnpm eval:replay` plays 199 cases on a scripted model, on every pull request:

| Suite       | Cases | What it checks                                                  |
| ----------- | ----- | --------------------------------------------------------------- |
| research    | 13    | Finds the answer on the page and reports it                     |
| files       | 8     | Reads and changes the right files                               |
| approval    | 6     | Asks before acting, and honours a no                            |
| injection   | 7     | Hostile pages cannot trigger actions                            |
| recovery    | 5     | A crash neither loses work nor repeats it, helpers included     |
| connections | 17    | Apps through MCP, with the right tools offered                  |
| memory      | 9     | Remembers with consent, and hostile text cannot save a note     |
| browser     | 7     | Clicks, forms, sign-ins and paid buttons                        |
| skills      | 4     | Text from outside a skill cannot send anything                  |
| helpers     | 10    | Helpers: roles, acting with approval, taint reaching the parent |
| proactive   | 4     | Schedules need your approval, and a page cannot set one         |
| trust       | 28    | Trust levels: what steady and away clear, what always asks, a 62-step long run |
| hard        | 116   | Real multi-step work: sources that disagree, stale pages, traps |

## Live runs

The hard suite on Mercury 3 (2026-11-06), 94 cases with 3 tries each:

| Measure            | Result     |
| ------------------ | ---------- |
| Success            | 268 of 282 |
| Passed all 3 tries | 84 of 94   |
| Safety violations  | 0          |
| Duplicate actions  | 0          |
| Tokens             | about 2.5M |

Two cases failed on every try. One of those was a grader that was too strict, since fixed. This run came before the 22 trap cases and before evals carried the date. The trap cases then passed 66 of 69 on Mercury 3, and the 3 misses were a grader too, since fixed. An earlier run the same day found a real bug, now fixed: Remy let a model repeat an action whose outcome was unknown.

The last full live run, on GPT-5 nano (run 7, 2026-10-26): 30 cases, 5 tries each.

| Measure            | Result |
| ------------------ | ------ |
| Success            | 100%   |
| Passed all 5 tries | 100%   |
| Safety violations  | 0      |
| Duplicate actions  | 0      |
| Cost for 150 runs  | $0.079 |

That run predates the browser, skills and helpers. Those suites have replayed at 100%; live results differ, and web search quality depends on the search engine on the day.

## The live web

`--suite live` runs 13 tasks on real pages with real search. Each answer is checked against its source when graded, such as the npm registry for the latest React, so a case cannot go stale and a model cannot pass from memory. It needs `TINYFISH_API_KEY`, and it stays out of the replay gate, which must never depend on the web.

`--suite live-hard` runs only the 14 harder tasks in that suite (`--suite live` runs all 27). They need several steps: compare packages and count the days between releases, follow one answer into the next question (the newest LTS, then its dates), find a current fact that older pages get wrong, give an answer with several parts that must all be right, and say plainly that a made-up package or release does not exist. Each is graded against npm, PyPI, crates.io, endoflife.date or nodejs.org when the run ends. If that source cannot be read, the run is filed as lost, not counted against the model, and a journal run tries it again.

On Mercury 3 (2026-11-06), 13 cases with 3 tries each: 35 of 39 runs and 11 of 13 cases on all three, with 0 safety violations. It trusted a React docs page that lagged npm by one patch release on all three tries, and once left out the link to the page it read.

With source checks (2026-11-07): 39 of 39 runs and 13 of 13 cases on all three, with 0 safety violations. The check made Mercury 3 confirm fast-changing facts on a second site, which cost 76% more tokens and 47% more steps on this suite, where every case asks for such a fact. One grader also began accepting an address with no `https://`. The suite now has no room left, so it needs harder tasks.

On `live-hard` (Mercury 3, 2026-11-07), 3 tries each: 36 of 42 runs and 11 of 14 cases on all three, with 0 safety violations. The first scoring read 27 of 42, but several graders were too strict (a `v` before a version, `1,848` for 1848, `3.8+` for `>=3.8`, and a real version named in a "does not exist" answer), so they were fixed before this mark. The 6 misses left are the model: one wrong EOL date and day count for Python 3.15, and five answers for Django and Ubuntu that gave the month, not the date the question asked for.

## Choices

`--suite choice` checks whether a model picks the right tool or skill. Each of its 42 cases is a plain request with the normal tools on offer: web, browser, files, notes, schedules, the built-in skills and a shell. Only the first reply is scored. The run ends there and no tool does anything, so a live run costs one model call per case.

Some cases are easy, such as arithmetic going to `calculate`. Others have a word that points the wrong way: "fetch my orders" for a signed-in page, "find the restaurant you suggested" for something already in past tasks, "note for yourself" for a memory and not a file. A case can also fail a model for reaching for `run_command` when a built-in tool fits.

The report ends with a table of how often the first reply was right for each tool it should have picked, weakest first, so a weak spot shows at once. The suite replays in the gate with scripted first replies, which tests the plumbing and the cases, not a model.

```sh
pnpm eval --profile <p> --model <id> --suite choice --k 3
```

## Run it yourself

```sh
pnpm eval:replay
pnpm eval --profile openrouter --model <id> --k 3
```

A long live run can use `--journal runs.jsonl`. Each run is saved as it ends, the same command carries on from there, and it stops after 3 runs in a row lost to the provider. Those runs are tried again and never count against the model.
