# Browser measured: Chrome and Lightpanda (2026-11-12)

V1 Stage 4 item. Remy's browser is Playwright driving Chrome. This measures Lightpanda (a small headless browser that serves CDP) as an optional second engine, on the owner's Mac (Apple silicon, macOS), with real pages over the network.

## What was tested

- Lightpanda nightly `1.1.0-nightly.12116+7eb382658` (commit 7eb3826586eafb9ff44ff4921480c0d95fb177a8), asset `lightpanda-aarch64-macos` from github.com/lightpanda-io/browser/releases/tag/nightly, saved to `~/.remy/engines/lightpanda` (92 MB, not in the repo).
- Chrome: the installed Google Chrome, headless, as Remy launches it today.
- Both driven the way Remy drives them: through `createLocalBrowser`, the same page reader (`SNAPSHOT_SCRIPT`) the tools use, the same address guards. Lightpanda is reached over CDP (`connectOverCDP`) on a free port on 127.0.0.1.
- Pages: 5 from a local fixture server (article, form, script-rendered page, table, home) and 5 public pages (example.com, a Wikipedia article, news.ycombinator.com, docs.python.org json page, github.com/microsoft/playwright). Plus one interaction: type into a field, press the button, land on the next page.
- 3 runs of each engine, each in its own process; the numbers below are medians. Script: `packages/browser/bench/measure.ts`, run with `pnpm --filter @remy/browser bench --runs 3`. Full per-run data was written next to this run in the session scratch folder, not committed.

## Numbers (medians of 3)

Through Remy (page reader, 500 ms network-idle settle, guards on):

|                                               | Chrome   | Lightpanda |
| --------------------------------------------- | -------- | ---------- |
| Cold start (launch, connect, first page read) | 1,909 ms | 740 ms     |
| 4 more fixture pages                          | 2,074 ms | 2,030 ms   |
| 5 public pages                                | 5,920 ms | 6,187 ms   |
| Peak memory of the browser processes          | 853 MB   | 130 MB     |
| Pages with usable text (of 10, all 3 runs)    | 10       | 10         |
| Form interaction (type, press, next page)     | 3 of 3   | 3 of 3     |

The Remy numbers for page loads are nearly the same because Remy waits for the network to go quiet after every page (Playwright's network-idle takes at least 500 ms), and that wait dominates. The engine alone, straight through Playwright with no wait and no reader, shows the real difference:

| Engine only (medians of 3)        | Chrome   | Lightpanda |
| --------------------------------- | -------- | ---------- |
| Start and connect to a blank tab  | 347 ms   | 83 ms      |
| 4 local pages (domcontentloaded)  | 40 ms    | 9 ms       |
| 5 public pages (domcontentloaded) | 2,476 ms | 2,046 ms   |
| Peak memory                       | 800 MB   | 97 MB      |

Cold start varies a lot from run to run on Chrome (1,065 ms in an earlier 3-run pass, 1,909 ms in this one); read the Chrome cold start as roughly 1 to 2 seconds.

## What failed on Lightpanda

No page failed. All 10 gave usable text and enough controls (the counts differ on two pages, below), and the form worked.

Differences that matter:

- **More noise in the text.** Lightpanda has no layout engine, so the reader cannot tell hidden or collapsed content from visible content. The Wikipedia article read 29,946 characters against Chrome's 20,326: the article text is the same in both, but Lightpanda also includes the collapsed menus and sidebar twice over (for example "Main menu" appears before the article, and the language list). The python docs page showed 250 controls against 174 for the same reason. More tokens per page for a model, and more things to click that are not on screen.
- **Not measured, so not claimed:** pages behind a bot check (Bing, DuckDuckGo search, Cloudflare), heavy single-page apps, file uploads and downloads, screenshots (Lightpanda draws nothing, so the web app's live Browser frame will be empty), `browser_show`. Search through Remy's browser was not run on Lightpanda.
- **Cannot do by design:** there is no window (`browser_show` says so plainly), and no saved profile. Sites that need a login do not work, and Remy says that in the browser's status line and in the `browser_show` error.
- Lightpanda is a nightly build of a young project; the only version tested is the one above.

## What was built

- `REMY_BROWSER_ENGINE=lightpanda` (optional `REMY_LIGHTPANDA_PATH`; default `~/.remy/engines/lightpanda`). Unset or `chrome` keeps Chrome. Env only: there is no config-file field, to match `REMY_BROWSER`.
- Remy starts `lightpanda serve --host 127.0.0.1 --port <free port>` itself, with `--block-private-networks` unless `REMY_BROWSER_LOCAL=on`, and telemetry off. Only loopback; the port is never exposed. It is stopped (SIGTERM, then SIGKILL after 2 s) when the browser closes, after 5 minutes unused, when the connection fails, and when Remy exits.
- If the program is missing, Remy prints how to get it and uses Chrome, with the same sentence in the browser's status line. Not silent. An unknown engine name, or setting both `REMY_BROWSER` (cloud) and the engine, is an error.
- The status line reads "Pages open in Lightpanda, a small headless engine on this computer. It has no saved logins or cookies, no window, and some pages will not work."
- Code: `packages/browser/src/engine.ts` (the only file in the package that starts a process; the spawn is injected for tests), small additions in `driver.ts` and `remote.ts`, wiring in `browserFor` in `apps/cli/src/cli.ts`.
- Tests: engine resolution, arguments, the process lifecycle with a fake spawn (start, wait for ready, stop, kill when it ignores a stop, stops at once, cannot run, never answers), the driver's notices and own-tab rule. One real-binary test, skipped unless `REMY_TEST_LIGHTPANDA=1` (run once by hand: passes).
- One bug found by the real binary: Lightpanda's start-up tab cannot navigate, so the driver opens a fresh tab for engines that ask for it (`ownTab`).

## Recommendation

Keep Chrome as the default. Lightpanda works for reading public pages and filling simple forms, uses about one seventh of the memory, and starts in a fraction of the time, but it cannot sign in to anything, has no window for the steps that need the person, shows more irrelevant text to the model, and is an unversioned nightly. Remy's task page loads are no faster in practice because of the network-idle wait. It is worth offering as an opt-in for low-memory machines, servers and read-only research, and worth revisiting when a tagged release exists and the hidden-content noise is handled in the reader (a per-engine filter for hidden elements would remove most of it). Not recommended: a silent automatic fallback to it.
