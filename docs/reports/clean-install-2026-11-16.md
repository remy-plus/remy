# Clean install check, 2026-11-16

Question: does Remy install and run on a machine that has never seen it? The published package was built
the way a release builds it, then installed into clean Docker containers (colima, arm64) and driven from
the host. No paid model calls: every model call went to a fake OpenAI-compatible server (`node:http`, SSE
streaming, scripted `finish` tool call). The real `~/.remy` and the Keychain were not touched (every run
used its own `REMY_HOME` inside a container).

Test material (outside git): `~/.remy-private/clean-install/` (`fake-model.mjs`, `run-env.sh`, `logs/`).

## 1. The package

Built with `pnpm bundle` (esbuild, then `write-bin.mjs`, then `copy-web.mjs`) and packed with `npm pack`
from `apps/cli`.

|                      |                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name, version        | `@koryei/remy` 0.10.1 (file `koryei-remy-0.10.1.tgz`, not `remy-*.tgz`)                                                                                                                                            |
| Tarball              | 1.1 MB (1,103,753 B before the fixes below; 1.1 MB after)                                                                                                                                                          |
| Unpacked             | 4.5 MB, 72 files                                                                                                                                                                                                   |
| Files                | `LICENSE`, `README.md`, `package.json`, `release/remy.js` (bin), `release/main.js` (3.6 MB bundle), `release/web/index.html`, one JS (562 KB) and one CSS (51 KB) file, 6 `.woff2` fonts, 58 app-logo `.svg` files |
| Runtime dependencies | `ink`, `playwright-core`, `react` (npm installs 42 packages in total)                                                                                                                                              |
| Not present          | tests, `.ts` sources, source maps, `.env*`, fixtures, anything from `~/.remy-private`, any `/Users/...` path, any key-shaped string (one grep hit, `sk-move-with-no-destination`, is an eval case id)              |

`devDependencies` with `workspace:*` are listed in the shipped `package.json`; npm ignores them on install.
The bundle also carries the eval cases (that is why `main.js` is 3.6 MB). Not changed.

## 2. Results

Times are wall clock inside the container on an arm64 colima VM (2 CPUs, 4 GB). "Fake model" means the
server above on `127.0.0.1:11434` in the same container; the browser setup route's only no-key provider is
Ollama, whose address is `localhost:11434`, so that is how the route reached the fake.

| Step                                         | node:22 (Debian 12, Node 22.23.5)                               | node:24 (Debian 12, Node 24.22.3) | node:22-alpine (musl, Node 22.23.5)        |
| -------------------------------------------- | --------------------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| `npm install -g ./koryei-remy-*.tgz`         | pass, 4.0 s                                                     | pass, 5.2 s                       | pass, 3.8 s                                |
| `remy --version`                             | pass, 0.2 s                                                     | pass, 0.3 s                       | pass, 0.3 s                                |
| `remy --help`                                | pass                                                            | pass                              | pass                                       |
| `remy doctor`                                | pass (exit 1: no model yet, as designed)                        | same                              | same                                       |
| `remy serve --port 7790 --host 0.0.0.0`      | pass (needs `REMY_SERVE_ALLOW_REMOTE=on`, by design)            | pass                              | pass                                       |
| `GET /api/health` from the host              | 200 `{"ok":true,"version":"0.10.1"}`                            | 200                               | 200                                        |
| index, JS, CSS, fonts, SVG load              | 200 each, right content types                                   | 200                               | 200                                        |
| `/api` without token / with first-run token  | 401 / 200                                                       | 401 / 200                         | 401 / 200                                  |
| `POST /api/setup/model` (ollama, fake model) | 200 (0.0 s)                                                     | 200                               | 200                                        |
| chat message, `/api/tasks/:id/stream`        | 4 live answer deltas, then `task.finished` with the answer      | same                              | same                                       |
| `remy run` against the fake via env          | pass, 0.3 s                                                     | pass                              | pass                                       |
| `remy browser install`                       | pass, 10.7 s, but Chromium cannot start (see section 3, item 5) | not run                           | not run (no musl Chromium from Playwright) |

Also checked:

- **Dockerfile image** (`docker build .`, `node:22-alpine`, 280 MB image, build 17 s with warm layers):
  starts and answers `/api/health` 0.35 s after `docker run`, shows `healthy` in `docker ps`, runs as the
  `remy` user, writes the first-run token to `/data/serve-token-first-run.txt` (mode 0600), serves a chat
  with streamed answer using `REMY_BASE_URL`, `REMY_MODEL` and `REMY_API_KEY`.
- **Server start time** with a cold `REMY_HOME`: 0.27 s to a working `/api/health` (node:24).
- **One-time link in a terminal** (`script` pty): `remy serve` prints the token and the link, the code
  trades for a session token once (200), the second use is 401 with a plain sentence. `--open` in a
  container prints "The browser could not be opened. Open the link above instead."
- **Wrong key in the browser setup**: `POST /api/setup/model` with a made-up OpenAI key returns 400 "OpenAI
  did not accept that key..." in 0.25 s, saves nothing, and the key is in no file.
- **Node 20**: npm only warns (EBADENGINE) and installs; see 3.4 for what running it did.
- **macOS assumptions**: none hit on Linux. Keychain use falls back to `logins.json` (0600) and no
  `say`/`open` call was reached; `--open` degrades as above.

## 3. Problems found, and fixes

Each fix is a small commit with a test.

1. **Database readable by other users (privacy).** With the usual umask 022 `~/.remy` was created 0755,
   `remy.sqlite` 0644, and its `-wal` and `-shm` files 0644. The `-wal` holds the latest prompts and
   answers. A chat-only run had the file at 0600 but never the `-wal`/`-shm`. Fix: `lockDownDatabase` creates
   the file 0600 before opening and chmods all three after the WAL is on (this also repairs databases made
   by older versions); a new `REMY_HOME` is created 0700. (`60d3c2d`)
2. **`remy doctor` said "Browser ok: Chrome, Edge or Chromium found" on a machine with none.** Both the
   Browser line and the search plan treated every non-Mac as having a browser. Now the probe looks in the
   places the browser package launches from (Chrome, Edge, the Playwright Chromium cache, honouring
   `PLAYWRIGHT_BROWSERS_PATH`). Windows still answers yes. (`8a8bf50`, `d9c8a63`)
3. **Two lines of "ExperimentalWarning: SQLite is an experimental feature" before every command on
   Node 22** (`--version`, `--help`, `doctor`, all of them). The published bin now hides only that warning.
   (`fb26109`)
4. **Node 20 crashed with a stack trace** (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`). The bin now prints
   "Remy needs Node 22.18 or newer, and this computer has Node 20.20.2. Install a newer Node from nodejs.org,
   then run remy again." and exits 1. (`83a4e2d`)
5. **Chromium installed by `remy browser install` fails on slim Debian** (missing `libnspr4.so`; the
   machine has no system libraries for it) and Remy showed only "Target page, context or browser has been
   closed". The launch error now names the library and the fix (`sudo npx playwright install-deps chromium`).
   `remy browser install` itself still says "Chromium is installed"; it does not install system libraries. (`32a85fe`)
6. **`remy doctor` said "Model problem: none connected" inside the Docker image** set up with
   `REMY_BASE_URL`, `REMY_MODEL`, `REMY_API_KEY` while the server was answering. A custom address now counts
   ("Model ok: custom endpoint"). (`53be124`)

## 4. Seen and not changed

- The tarball is `koryei-remy-*.tgz`; the README installs `@koryei/remy` from npm, which matches the
  package name.
- `--host 0.0.0.0` is refused unless `REMY_SERVE_ALLOW_REMOTE=on`. The message is clear and the Dockerfile
  sets it. The "listens on http://0.0.0.0:7790" line is not an address a person can open.
- The first-run token file stays in `REMY_HOME` after sign-in until the person deletes it (documented).
- Inside a container `remy doctor` can recommend "Free up about 1 GB before using a container" on a
  9 GB-free Docker VM disk, and says "Reach: light. Uses the hidden browser." when there is no browser.
- `remy doctor` exits 1 when no model is connected (right for a script, noisy for a first look).
- Chromium on musl (Alpine) is not available from Playwright, so browser tasks there need a cloud browser or
  a different image. Search and chat work.
- Not run: Windows, a real macOS clean account, a real microphone, a real outside webhook sender, the
  Dockerfile on an amd64 host (these runs were arm64), a model with a real key.
