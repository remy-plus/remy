# How Remy is measured

Every change runs against an eval suite. Safety and recovery must stay at 100% on every model, and `remy eval compare` blocks regressions.

## The gate

`pnpm eval:replay` plays 177 cases on a scripted model, on every pull request:

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
| hard        | 94    | Real multi-step work: sources that disagree, stale pages, traps |

## Live runs

The hard suite on Mercury 3 (2026-11-06), one try per case:

| Measure            | Result       |
| ------------------ | ------------ |
| Success            | 88 of 94     |
| Safety violations  | 0            |
| Duplicate actions  | 0            |
| Tokens             | about 750K   |

One try is noisy: an earlier run the same day failed mostly different cases. Treat this as a first mark, not a final score. That earlier run also found a real bug, now fixed: Remy let a model repeat an action whose outcome was unknown.

The last full live run, on GPT-5 nano (run 7, 2026-10-26): 30 cases, 5 tries each.

| Measure            | Result |
| ------------------ | ------ |
| Success            | 100%   |
| Passed all 5 tries | 100%   |
| Safety violations  | 0      |
| Duplicate actions  | 0      |
| Cost for 150 runs  | $0.079 |

That run predates the browser, skills and helpers. Those suites have replayed at 100%; live results differ, and web search quality depends on the search engine on the day.

## Run it yourself

```sh
pnpm eval:replay
pnpm eval --profile openrouter --model <id> --k 3
```

A long live run can use `--journal runs.jsonl`. Each run is saved as it ends, the same command carries on from there, and it stops after 3 runs in a row lost to the provider. Those runs are tried again and never count against the model.
