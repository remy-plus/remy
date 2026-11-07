# Eval: mercury-3

2026-11-07, k=3, 42 runs.

| Suite | Cases | Success | pass^k | Safety | Duplicates | Human touches | Steps | Tokens in/out | Cost | Wall p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| live | 14 | 86% | 79% | 0 | 0 | 0.0 | 7.3 | 45683/2081 | $0.0879 | 9354ms / 19947ms |
| **overall** | 14 | 86% | 79% | 0 | 0 | 0.0 | 7.3 | 45683/2081 | $0.0879 | 9354ms / 19947ms |

Stable prompt prefix: each request repeats 100% of the one before it (100% means it only appends, so a prompt cache can reuse it all).

## Failures

- `live-hard-python-support-span` run 2 (wrong_answer): matchesAll(python span): answer "The newest stable Python feature release is Python 3.15.\n\n- Version: Python 3.15 (latest patch: 3.15.2, released Oct 26, 2026)\n- First released: October 9, 2026 (3.15.0 final, confirmed by PEP 790)\n- " lacks end of life (2031-10-31), days (1848)
- `live-hard-django-lts` run 1 (wrong_answer): matchesAll(django lts): answer "Based on the official Django download page, the newest long-term support (LTS) release series that is already out is:\n\n- **Series:** Django 5.2 LTS\n- **Newest patch version:** 5.2.19\n- **Support ends:" lacks end of support (2028-04-30)
- `live-hard-django-lts` run 2 (wrong_answer): matchesAll(django lts): answer "The newest Django long-term-support (LTS) release series already out is **5.2 LTS**.\n\n- **Series:** Django 5.2 (LTS)\n- **Newest patch version:** 5.2.19\n- **Support ends:** April 2028 (extended support" lacks end of support (2028-04-30)
- `live-hard-ubuntu-lts` run 0 (schema_invalid): matchesAll(ubuntu lts): answer "The newest released Ubuntu LTS is **Ubuntu 26.04 LTS**, codenamed **\"Resolute Raccoon\"**, released on April 23, 2026. Its standard support (standard security maintenance) ends in **May 2031** (with ex" lacks end of support (2031-05-29)
- `live-hard-ubuntu-lts` run 1 (wrong_answer): matchesAll(ubuntu lts): answer "I've confirmed this on multiple independent sources, all of which agree.\n\n**Newest released Ubuntu LTS: Ubuntu 26.04 LTS**\n- **Version number:** 26.04\n- **Codename:** Resolute Raccoon\n- **Released:** " lacks end of support (2031-05-29)
- `live-hard-ubuntu-lts` run 2 (wrong_answer): matchesAll(ubuntu lts): answer "The newest released Ubuntu LTS is **Ubuntu 26.04 LTS** — codename **\"Resolute Raccoon\"**, released April 2026. Its standard support (standard security maintenance) ends **May 2031** (with Ubuntu Pro/e" lacks end of support (2031-05-29)
