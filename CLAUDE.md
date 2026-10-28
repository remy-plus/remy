# Remy

Universal AI agent: one chat box that gets real digital work done for anyone. Long-term aim is AGI/ASI; near-term aim is a capable, reliable agent that is stupidly simple to use.

**The full architecture and phased plan live in `PLAN.md`. Read it before starting work, and keep it updated when decisions change.**

## Decisions so far
- **Surface:** V1 is a terminal app (Ink), tracked in `V1.md` (decided 2026-10-25). Web app + PWA (Next.js) come after V1; voice and desktop later.
- **Execution:** all routes, most reliable first: API/MCP integrations → cloud browser (DOM first, vision fallback) → device agent on the user's machine (Phase 4).
- **Stack:** TypeScript end to end, pnpm workspaces. Phase 0: CLI + SQLite (built-in `node:sqlite`) + zod + vitest + Biome, no server/queue/Docker. Phase 1 adds Postgres (same `EventStore` interface), Hono, Next.js PWA, worker pool. Python only for the future `research/` track.
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
- Run the CLI from source: `pnpm remy ...`; evals: `pnpm eval:replay` (CI gate), `pnpm eval -- --profile <p> --model <id>`.
- `pnpm check` = lint + typecheck (src and tests) + `tsc -b` build + tests. Every step must end green on it.
- Packages export `src/` under the custom condition `@remy/source` (TS) and a vitest alias, `dist/` otherwise. Tests are colocated `*.test.ts` and excluded from the build.
- `test/boundaries.test.ts` enforces the package dependency graph. Adding an edge means editing `ALLOWED` there on purpose.
- Build workflow (which model writes which step) is in PLAN.md.

## Status
- 2026-10-28: 0.4.0 onboarding built on branch `onboarding-0.4`, unreleased (tour, local profile, `/profile`, `/tour`; report in `docs/reports/0.4-onboarding.md`). Needs owner review, a live pass with a real key, version bump and release.
- 2026-10-27: **0.3.0 shipped** (npm `@koryei/remy@0.3.0` verified, GitHub release v0.3.0; site unchanged). Bin path must stay `release/remy.js` without `./` (newer npm drops it). Next: **0.4.0 = personalised onboarding** (Notion Ideas: name, goals, real first task from their answers, local /profile).
- 2026-10-27 (evening): **0.3 full-screen terminal built and pushed, not released.** On Ink 8 (alternate screen, incremental rendering): centered home, scrolling session with sticky bottom, framed prompt, centered dialogs (palette, /model, /sessions, /login), sidebar >120 cols (Ctrl+B), Ctrl+R, real cursor, motion, `/theme` (auto/light/dark, /day /night), `--minimal` replaces `--classic` (hidden alias). ~3.5x fewer bytes per streamed token than 0.2. `pty-smoke.py --mode full|minimal`. Next: owner's ideas in Notion (onboarding, personalised, High), then 0.3 screenshots, docs, CHANGELOG, release. Owner's usage is limited: max 1–2 agents at a time.
- 2026-10-27: project tracking moved to Notion: the private **Remy** page (https://app.notion.com/p/407c738dceac81be8732cbecf5b9d277) holds Roadmap, 0.3 Tasks, Releases, Evals, Research and Decisions databases. Keep the 0.3 Tasks board current as work lands; the repo (PLAN.md) stays the source of truth.
- 2026-10-27: **0.3 phases A, B, C built** (reviewed and merged by Opus): full-screen chat in `apps/cli/src/screen/` (layout, scroll, rows, viewport, prompt box, status row, `FullApp`), default on a TTY; `--classic` or `REMY_SCREEN=classic` keeps the 0.2 UI. Key handling is shared in `chat-keys.ts`. Next: Opus review and merge, then D (home), E (dialogs), F (sidebar).
- 2026-10-27: **0.2.0 shipped** (npm, GitHub release v0.2.0, site redeployed). Owner: "a good start, not great yet". Next session: hear what feels off first, then Groq baseline (needs GROQ_API_KEY), Copilot sign-in (needs a GitHub App Client ID), REA setup if wanted.
- 2026-10-26: chat ease-of-use pass (`design/research/engineering/opencode-ease.md`): first run opens the login panel, `/model`, `/login`, `/sessions`, Ctrl+P palette, `/` autocomplete, `@file` references, errors that end with the next step. Pushed; ships in 0.2.0 (published by the owner with `npm publish`).
- 2026-10-26: **V1 shipped (v0.1.0).** npm `@koryei/remy` (publish needs the owner's 2FA, so they run `npm publish` in apps/cli), GitHub release v0.1.0, site live on https://remy.plus (Vercel project remy-plus, deploy with `vercel deploy --prod` in apps/site; DNS on Cloudflare, DNS only). Next: 0.2 = `design/research/terminal-plan.md` + an open-weight baseline.
- 2026-10-26: chat rendering rebuilt (finished items in Ink `<Static>`, short live region, queued input, markdown replies); verified live with `apps/cli/scripts/pty-smoke.py` (needs pyte). Site in `apps/site` (static, Vercel root `apps/site`). Evals model chat follow-ups. Run 8: 97% on 34 cases. Waiting on: npm name + publish go, Vercel deploy, full re-run.
- 2026-10-25: V1 work package 3 (Ink chat UI) done: plain `remy` opens a multi-turn chat (`apps/cli/src/chat.ts` controller, `chat-ui.ts` components, `theme.ts`, `--debug`). No JSX; components use `createElement`.
- 2026-10-26: GPT-5 nano run 7 (k=5): 100% on all 30 cases, pass^5 100%, 0 safety violations, 0 duplicates, $0.079 for 150 runs. V1 (terminal) work under way, tracked in `V1.md`.
- 2026-10-25: GPT-5 nano run 6 (k=5): 99% success, pass^5 97%, files and research 100% twice in a row, 0 safety violations, 0 duplicates, $0.087 for 150 runs. Fixes since the baseline: question cap, loop guard resets on progress, plain-text requests pause the task. Next: 1–2 open-weight baselines, then Phase 1.
- 2026-10-25: first live baseline, GPT-5 nano k=3: 88% success, pass^3 83%, 0 safety violations, 0 duplicates, $0.055 for 90 runs (`evals/results/`). Fixed: GPT-5 request parameters, empty replies no longer count as success, reasoning models get an 8k output limit, two over-strict graders. Next: re-run GPT-5 nano, add 1–2 open-weight baselines, then Phase 1.
- 2026-10-25: Phase 0 prototype working (steps 1–10). `pnpm remy run "..."`, `pnpm eval:replay` 30/30. Pushed to github.com/remy-plus/remy. Next: step 11 live baselines (needs OPENROUTER_API_KEY or Ollama), then Phase 1.
- 2026-10-24: step 1 (scaffold) done: workspace, 6 packages, boundary test, `pnpm check` green. Build workflow added to PLAN.md. Next: step 2 (events, `TaskState`, reducer).
- 2026-10-24: branding done (`branding/`): brand guide, ASCII/SVG logos, GitHub avatar, social preview, org profile README.
- 2026-10-23: PLAN.md v2: Phase 0 narrowed and fully specified (interfaces, 11-step implementation order, exit criteria). Next: step 1 scaffold.
- 2026-10-23: plan v1 written. No code yet.
