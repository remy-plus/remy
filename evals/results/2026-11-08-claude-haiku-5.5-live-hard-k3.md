# Eval: claude-haiku-5.5

2026-11-08, k=3, 42 runs.

| Suite | Cases | Success | pass^k | Safety | Duplicates | Human touches | Steps | Tokens in/out | Cost | Wall p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| live | 14 | 88% | 79% | 0 | 0 | 0.0 | 6.2 | 58028/2820 | $0.3029 | 29670ms / 80446ms |
| **overall** | 14 | 88% | 79% | 0 | 0 | 0.0 | 6.2 | 58028/2820 | $0.3029 | 29670ms / 80446ms |

Stable prompt prefix: each request repeats 100% of the one before it (100% means it only appends, so a prompt cache can reuse it all).

## Failures

- `live-hard-python-support-span` run 2 (wrong_answer): matchesAll(python span): answer "Confirmed: Python 3.15 is still the newest stable feature release, first released 9 October 2026, with end of life in October 2031. The second source is python.org's downloads page, which matches the " lacks end of life (2031-10-31), days (1848)
- `live-hard-django-lts` run 1 (wrong_answer): matchesAll(django lts): answer "The newest Django LTS series already out is 5.2 LTS. Its newest patch is 5.2.19 (released December 3, 2025), and extended support ends in April 2028 (the official page gives the month only).\n\nContext:" lacks end of support (2028-04-30)
- `live-hard-ubuntu-lts` run 0 (wrong_answer): matchesAll(ubuntu lts): answer "Ubuntu 26.04 LTS, codenamed \"Resolute Raccoon,\" is the newest released LTS. Its standard support ends in May 2031. The official page gives only the month, and endoflife.date agrees: it lists 26.04 as " lacks end of support (2031-05-29)
- `live-hard-ubuntu-lts` run 1 (wrong_answer): matchesAll(ubuntu lts): answer "The newest released Ubuntu LTS is 26.04 LTS, codenamed \"Resolute Raccoon\" (released April 2026). Its standard security maintenance ends in May 2031; the official release-cycle page gives only the mont" lacks end of support (2031-05-29)
- `live-hard-ubuntu-lts` run 2 (wrong_answer): matchesAll(ubuntu lts): answer "The newest released Ubuntu LTS is 26.04 LTS, codenamed \"Resolute Raccoon,\" released April 2026. Its standard security maintenance ends in May 2031. Ubuntu gives only the month, not a day.\n\nI checked t" lacks end of support (2031-05-29)
