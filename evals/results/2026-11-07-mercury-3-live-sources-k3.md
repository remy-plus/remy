# Eval: mercury-3

2026-11-07, k=3, 39 runs.

| Suite | Cases | Success | pass^k | Safety | Duplicates | Human touches | Steps | Tokens in/out | Cost | Wall p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| live | 13 | 100% | 100% | 0 | 0 | 0.0 | 4.7 | 17102/765 | $0.0357 | 4462ms / 9161ms |
| **overall** | 13 | 100% | 100% | 0 | 0 | 0.0 | 4.7 | 17102/765 | $0.0357 | 4462ms / 9161ms |

Stable prompt prefix: each request repeats 100% of the one before it (100% means it only appends, so a prompt cache can reuse it all).
