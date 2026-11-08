# Eval: claude-haiku-5.5

2026-11-08, k=3, 126 runs.

| Suite | Cases | Success | pass^k | Safety | Duplicates | Human touches | Steps | Tokens in/out | Cost | Wall p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| choice | 42 | 83% | 79% | 0 | 0 | 0.2 | 1.9 | 5462/179 | $0.0801 | 4574ms / 6984ms |
| **overall** | 42 | 83% | 79% | 0 | 0 | 0.2 | 1.9 | 5462/179 | $0.0801 | 4574ms / 6984ms |

Stable prompt prefix: each request repeats 100% of the one before it (100% means it only appends, so a prompt cache can reuse it all).

## Choices by expected tool

| Should pick | Runs | Right |
|---|---|---|
| delegate | 6 | 0% (0/6) |
| none | 6 | 0% (0/6) |
| schedule_task | 3 | 0% (0/3) |
| web_search | 9 | 56% (5/9) |
| use_skill:research | 9 | 78% (7/9) |
| use_skill:write-and-send | 6 | 83% (5/6) |
| ask_user|email_read|list_files|recall | 3 | 100% (3/3) |
| ask_user|list_files | 3 | 100% (3/3) |
| browser_open | 3 | 100% (3/3) |
| browser_open|browser_show | 6 | 100% (6/6) |
| calculate | 9 | 100% (9/9) |
| fetch_url | 9 | 100% (9/9) |
| fetch_url|browser_open | 3 | 100% (3/3) |
| list_files | 3 | 100% (3/3) |
| list_files|move_file | 3 | 100% (3/3) |
| list_files|read_file | 3 | 100% (3/3) |
| not | 3 | 100% (3/3) |
| recall | 9 | 100% (9/9) |
| remember | 9 | 100% (9/9) |
| schedule_task|ask_user | 3 | 100% (3/3) |
| schedule_task|list_schedules | 3 | 100% (3/3) |
| update_plan | 3 | 100% (3/3) |
| update_plan|list_files | 3 | 100% (3/3) |
| use_skill:compare-and-buy | 6 | 100% (6/6) |
| write_file | 3 | 100% (3/3) |

## Failures

- `choice-search-no-address` run 2 (wrong_answer): choseTool(web_search not fetch_url): first reply called finish
- `choice-search-open-the-docs` run 0 (wrong_answer): choseTool(web_search not fetch_url): first reply called fetch_url (fetch_url)
- `choice-search-open-the-docs` run 1 (wrong_answer): choseTool(web_search not fetch_url): first reply called fetch_url (fetch_url)
- `choice-search-open-the-docs` run 2 (wrong_answer): choseTool(web_search not fetch_url): first reply called fetch_url (fetch_url)
- `choice-schedule-a-reminder` run 0 (wrong_answer): choseTool(schedule_task): first reply called no tool
- `choice-schedule-a-reminder` run 1 (wrong_answer): choseTool(schedule_task): first reply called no tool
- `choice-schedule-a-reminder` run 2 (wrong_answer): choseTool(schedule_task): first reply called finish
- `choice-skill-research-check-a-claim` run 0 (wrong_answer): choseSkill(research): first reply called web_search
- `choice-skill-research-check-a-claim` run 1 (wrong_answer): choseSkill(research): first reply called web_search
- `choice-skill-write-and-send-reply` run 2 (wrong_answer): choseSkill(write-and-send): first reply called email_read
- `choice-delegate-three-pricing-pages` run 0 (wrong_answer): choseTool(delegate): first reply called fetch_url, fetch_url, fetch_url
- `choice-delegate-three-pricing-pages` run 1 (wrong_answer): choseTool(delegate): first reply called fetch_url, fetch_url, fetch_url
- `choice-delegate-three-pricing-pages` run 2 (wrong_answer): choseTool(delegate): first reply called fetch_url, fetch_url, fetch_url
- `choice-delegate-five-laptops` run 0 (wrong_answer): choseTool(delegate): first reply called update_plan, web_search, web_search, web_search, web_search, web_search
- `choice-delegate-five-laptops` run 1 (wrong_answer): choseTool(delegate): first reply called web_search, web_search, web_search, web_search, web_search
- `choice-delegate-five-laptops` run 2 (wrong_answer): choseTool(delegate): first reply called web_search, web_search, web_search, web_search, web_search
- `choice-plain-thanks` run 0 (wrong_answer): choseNoTool: first reply called recall
- `choice-plain-thanks` run 1 (wrong_answer): choseNoTool: first reply called finish
- `choice-plain-thanks` run 2 (wrong_answer): choseNoTool: first reply called recall
- `choice-plain-python-list-or-tuple` run 0 (wrong_answer): choseNoTool: first reply called finish
- `choice-plain-python-list-or-tuple` run 1 (wrong_answer): choseNoTool: first reply called finish
- `choice-plain-python-list-or-tuple` run 2 (wrong_answer): choseNoTool: first reply called finish
