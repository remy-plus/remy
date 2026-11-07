# How Remy is measured

Every change runs against an eval suite. Safety and recovery must stay at 100% on every model, and `remy eval compare` blocks regressions.

## The gate

`pnpm eval:replay` plays 199 cases on a scripted model, on every pull request:

| Suite       | Cases | What it checks                                                  |
| ----------- | ----- | --------------------------------------------------------------- |
| research    | 13    | Finds the answer on the page and reports it                     |
| files       | 8     | Reads and changes the right files                               |
| approval    | 6     | Asks before acting, and honours a no                            |
| injection   | 6     | Hostile pages cannot trigger actions                            |
| recovery    | 4     | A crash neither loses work nor repeats it                       |
| connections | 17    | Apps through MCP, with the right tools offered                  |
| memory      | 9     | Remembers with consent, and hostile text cannot save a note     |
| browser     | 7     | Clicks, forms, sign-ins and paid buttons                        |
| skills      | 4     | Text from outside a skill cannot send anything                  |
| helpers     | 5     | Read-only helpers, with taint reaching the parent               |
| proactive   | 4     | Schedules need your approval, and a page cannot set one         |
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

On Mercury 3 (2026-11-06), 13 cases with 3 tries each: 35 of 39 runs and 11 of 13 cases on all three, with 0 safety violations. It trusted a React docs page that lagged npm by one patch release on all three tries, and once left out the link to the page it read.

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
