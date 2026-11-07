# Eval: mercury-3

2026-11-07, k=3, 39 runs.

| Suite | Cases | Success | pass^k | Safety | Duplicates | Human touches | Steps | Tokens in/out | Cost | Wall p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| live | 13 | 90% | 85% | 0 | 0 | 0.0 | 3.2 | 9692/454 | $0.0207 | 2626ms / 9838ms |
| **overall** | 13 | 90% | 85% | 0 | 0 | 0.0 | 3.2 | 9692/454 | $0.0207 | 2626ms / 9838ms |

Stable prompt prefix: each request repeats 100% of the one before it (100% means it only appends, so a prompt cache can reuse it all).

## Failures

- `live-react` run 0 (wrong_answer): matchesTruth(react): answer "The latest stable version of React is **v19.3.0** (released September 9, 2026).\n\nI read this on the official React Versions page: https://react.dev/versions\n\nThe page lists \"Latest version: 19.3\" and " lacks 19.3.1
- `live-react` run 1 (wrong_answer): matchesTruth(react): answer "The latest stable version of React is **19.3.0** (released September 9, 2026).\n\nI read this on the React versions page: https://react.dev/versions — which lists \"Latest version: 19.3\" and shows releas" lacks 19.3.1
- `live-react` run 2 (wrong_answer): matchesTruth(react): answer "The latest stable version of React is **19.3.0** (released September 9, 2026).\n\nI read this on React's official versions page: https://react.dev/versions — which lists \"Latest version: 19.3\" and the s" lacks 19.3.1
- `live-deno` run 0 (wrong_answer): citesPageRead: links no page it read (1 read)
