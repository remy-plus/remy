# Eval: mercury-3

2026-11-07, k=3, 126 runs.

| Suite | Cases | Success | pass^k | Safety | Duplicates | Human touches | Steps | Tokens in/out | Cost | Wall p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| choice | 42 | 90% | 79% | 0 | 0 | 0.2 | 2.0 | 3864/180 | $0.0163 | 526ms / 3225ms |
| **overall** | 42 | 90% | 79% | 0 | 0 | 0.2 | 2.0 | 3864/180 | $0.0163 | 526ms / 3225ms |

Stable prompt prefix: each request repeats 100% of the one before it (100% means it only appends, so a prompt cache can reuse it all).

## Choices by expected tool

| Should pick | Runs | Right |
|---|---|---|
| delegate | 6 | 50% (3/6) |
| web_search | 9 | 56% (5/9) |
| browser_open | 3 | 67% (2/3) |
| browser_open|browser_show | 6 | 83% (5/6) |
| none | 6 | 83% (5/6) |
| use_skill:write-and-send | 6 | 83% (5/6) |
| use_skill:research | 9 | 89% (8/9) |
| ask_user|email_read|list_files|recall | 3 | 100% (3/3) |
| ask_user|list_files | 3 | 100% (3/3) |
| calculate | 9 | 100% (9/9) |
| fetch_url | 9 | 100% (9/9) |
| fetch_url|browser_open | 3 | 100% (3/3) |
| list_files | 3 | 100% (3/3) |
| list_files|move_file | 3 | 100% (3/3) |
| list_files|read_file | 3 | 100% (3/3) |
| not | 3 | 100% (3/3) |
| recall | 9 | 100% (9/9) |
| remember | 9 | 100% (9/9) |
| schedule_task | 3 | 100% (3/3) |
| schedule_task|ask_user | 3 | 100% (3/3) |
| schedule_task|list_schedules | 3 | 100% (3/3) |
| update_plan | 3 | 100% (3/3) |
| update_plan|list_files | 3 | 100% (3/3) |
| use_skill:compare-and-buy | 6 | 100% (6/6) |
| write_file | 3 | 100% (3/3) |

## Failures

- `choice-search-open-the-docs` run 0 (wrong_answer): choseTool(web_search not fetch_url): first reply called fetch_url (fetch_url, web_search)
- `choice-search-open-the-docs` run 1 (wrong_answer): choseTool(web_search not fetch_url): first reply called fetch_url (fetch_url)
- `choice-search-open-the-docs` run 2 (wrong_answer): choseTool(web_search not fetch_url): first reply called fetch_url (fetch_url)
- `choice-browser-script-page` run 1 (schema_invalid): choseTool(browser_open not fetch_url): first reply called update_plan
- `choice-browser-fetch-my-orders` run 2 (wrong_answer): choseTool(browser_open|browser_show not fetch_url): first reply called fetch_url (fetch_url)
- `choice-search-bus-times-once` run 0 (wrong_answer): choseTool(web_search not schedule_task): first reply called use_skill
- `choice-skill-research-what-is-known` run 2 (schema_invalid): choseSkill(research): first reply called update_plan
- `choice-skill-write-and-send-reply` run 1 (wrong_answer): choseSkill(write-and-send): first reply called recall, list_files, email_read
- `choice-delegate-three-pricing-pages` run 0 (wrong_answer): choseTool(delegate): first reply called update_plan, fetch_url, fetch_url, fetch_url
- `choice-delegate-three-pricing-pages` run 2 (wrong_answer): choseTool(delegate): first reply called use_skill, update_plan
- `choice-delegate-five-laptops` run 1 (wrong_answer): choseTool(delegate): first reply called update_plan
- `choice-plain-thanks` run 1 (wrong_answer): choseNoTool: first reply called finish
