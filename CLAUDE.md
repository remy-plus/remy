# Remy

Universal AI agent: one chat box that gets real digital work done for anyone. Long-term aim is AGI/ASI; near-term aim is a capable, reliable agent that is stupidly simple to use.

**The full architecture and phased plan live in `PLAN.md`. Read it before starting work, and keep it updated when decisions change.**

## Decisions so far
- **Surface:** web app + PWA first (Next.js). Voice and desktop come later.
- **Execution:** all routes, most reliable first: API/MCP integrations → cloud browser (DOM first, vision fallback) → device agent on the user's machine (Phase 4).
- **Stack:** TypeScript end to end, pnpm workspaces. Phase 0: CLI + SQLite (better-sqlite3) + zod + vitest + Biome, no server/queue/Docker. Phase 1 adds Postgres (same `EventStore` interface), Hono, Next.js PWA, worker pool. Python only for the future `research/` track.
- **Models:** users pick their own. Phase 0 uses a thin in-house OpenAI-compatible client behind `ModelClient` (covers OpenRouter, Ollama, vLLM, Groq, OpenAI); Vercel AI SDK optional later. Testing uses cheap or free open-weight models, so the weak-model adapter (constrained JSON tool calls, few tools per step) matters.
- **Scope:** "everything" (J.A.R.V.I.S.). The architecture is general; each domain ships only once its eval suite passes.
- **Core principles (enforced in code, see PLAN.md "Core design rules"):**
  - Event-sourced tasks; the runner computes `nextAction(state)`, so crash recovery = re-read events.
  - Write-ahead `tool.started`; recovery branches on each tool's `effect` (none / idempotent / reconcilable / unsafe_to_retry); never blind-retry side effects.
  - Tools only run as `AuthorizedCall` (branded type minted by policy). Approvals bind to `argsHash`, single use. Untrusted output taints the task → any non-read action needs approval.
  - Tools get `ScopedFs` / `ScopedFetch` / `SecretReader`, never raw `fs`/`fetch`.
  - Evals from day one: safety + recovery suites must be 100% on every model; `remy eval compare` blocks regressions.
  - Single agent loop; `core` depends only on interfaces.

## Brand
`branding/README.md` is the brand guide. Personality: intelligent, calm, capable, precise, human, understated ("Quiet confidence. Extraordinary capability."). The logo is `REMY` in the figlet font Cosmike, letters hand-spaced; colors ink `#0F0F10`, paper `#EDEBE6`, stone `#8C8A85`, signal `#A8C49A` (accent only); type is JetBrains Mono (Bold logo, line height 1.1, subtle top-to-bottom brightness ramp, grain backdrop). All user-facing copy (CLI included) follows the voice rules there: outcome first, no hype, no exclamation marks.

## Dev
- pnpm 12 via corepack (shim in `~/.local/bin`). TypeScript 7 (native `tsc`), vitest 5, Biome 2.
- `pnpm check` = lint + typecheck (src and tests) + `tsc -b` build + tests. Every step must end green on it.
- Packages export `src/` under the custom condition `@remy/source` (TS) and a vitest alias, `dist/` otherwise. Tests are colocated `*.test.ts` and excluded from the build.
- `test/boundaries.test.ts` enforces the package dependency graph. Adding an edge means editing `ALLOWED` there on purpose.
- Build workflow (which model writes which step) is in PLAN.md.

## Status
- 2026-10-24: step 1 (scaffold) done: workspace, 6 packages, boundary test, `pnpm check` green. Build workflow added to PLAN.md. Next: step 2 (events, `TaskState`, reducer).
- 2026-10-24: branding done (`branding/`): brand guide, ASCII/SVG logos, GitHub avatar, social preview, org profile README.
- 2026-10-23: PLAN.md v2: Phase 0 narrowed and fully specified (interfaces, 11-step implementation order, exit criteria). Next: step 1 scaffold.
- 2026-10-23: plan v1 written. No code yet.
