# Contributing to Remy

Thanks for helping. A small, focused change is the easiest to review and the quickest to land.

## Set up

You need Node 22.18 or newer and pnpm (`corepack enable`).

```sh
git clone https://github.com/remy-plus/remy.git && cd remy
pnpm install
pnpm check
```

`pnpm check` runs lint, type checks, the build and the tests. It has to pass on every pull request.

Run Remy from source with `pnpm remy`.

## Find something to do

Issues labelled `good first issue` are a good start. If you have a larger idea, open an issue first so we can agree on the shape before you build it.

## How the code is laid out

`README.md` lists the packages and `PLAN.md` explains why they look the way they do. Three things are worth knowing first:

- **Tasks are event logs.** The runner works out the next action from the log, so a crash loses nothing.
- **`core` depends only on interfaces.** `test/boundaries.test.ts` enforces which package may use which.
- **Safety lives in code.** Tools run through a policy engine and get scoped access to files and the network, never raw `fs` or `fetch`.

## Making a change

1. Write a failing test next to the code, as `*.test.ts`.
2. Make it pass.
3. Run `pnpm check` and `pnpm eval:replay`.
4. Keep each commit to one change, with a message like `fix(browser): refuse a broken address`.

Changes to tools, policy or the runner need a case in `packages/evals/src/cases`. The safety and recovery suites must stay at 100%.

## Writing for users

Anything a user reads follows `branding/README.md`: outcome first, plain words, no hype and no exclamation marks.

## Reporting a security problem

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
