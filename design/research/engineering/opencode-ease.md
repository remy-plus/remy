# OpenCode ease of use, and Remy's gaps

Source: sst/opencode tag **v1.19.4**, tarball from codeload.github.com, read 2026-10-26. Paths are under `packages/tui/src/`. "Verified" means read in the source; "inferred" means deduced from names or structure. Companion to `opencode.md` (architecture) and `../opencode-tui.md` (look and feel).

## What makes OpenCode easy

| Area                          | What it does                                                                                                                                                                                                                                                                                     | Status                                       | Where                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| First run, nothing configured | Sending a prompt with no provider shows a toast, "Connect a provider to send prompts", and if the provider list is empty opens the connect dialog. The app never exits for lack of a key.                                                                                                        | Verified                                     | `component/prompt/index.tsx:216-224`                               |
| Connect                       | `/connect` (command `provider.connect`) opens "Connect a provider": a list with a Popular group, a Providers group and "Other" (custom id), then an auth step per provider (API key prompt, or browser/OAuth code).                                                                              | Verified                                     | `app.tsx:727-735`; `component/dialog-provider.tsx:58-230`          |
| Switch model                  | `/models` (alias `/mo`) opens a searchable list: Favorites, Recents, then each connected provider's models, with a "Free" footer on zero-cost ones. When nothing is connected the same list shows "Popular providers" so the next step is one Enter away. Choosing a model records it as recent. | Verified                                     | `app.tsx:619-624`; `component/dialog-model.tsx:26-143`             |
| Command palette               | `ctrl+p` (`command_list`) lists every command. Each command carries title, category, optional `slashName` and `slashAliases`, so the palette and the `/` list are one registry.                                                                                                                  | Verified                                     | `config/keybind.ts:57`; `app.tsx:551-845`                          |
| Leader key                    | `ctrl+x` then a letter for sessions, new, export, exit; a which-key overlay lists the options.                                                                                                                                                                                                   | Verified (bindings), inferred (overlay look) | `config/keybind.ts:41-112`; `feature-plugins/system/which-key.tsx` |
| Slash autocomplete            | Typing `/` opens a list ranked by fuzzysort over the name and, for `/` only, the description. Description is printed after the name.                                                                                                                                                             | Verified                                     | `component/prompt/autocomplete.tsx:492-520, 770`                   |
| `@` references                | `@` triggers when the nearest `@` before the cursor has no whitespace after it. Files are fuzzy-ranked with frecency; agents and MCP resources share the list; picking a folder appends `/` and keeps completing.                                                                                | Verified                                     | `autocomplete.tsx:335, 518, 576, 702-705`                          |
| Keybinding hints              | Dialogs print the shortcut next to the action (`useCommandShortcut`), and destructive keys ask to be pressed twice ("Press X again to confirm").                                                                                                                                                 | Verified                                     | `component/dialog-session-list.tsx:58, 205, 246`                   |
| Errors                        | A reusable `DialogRetryAction` takes title, message, action label and link, so a failure can carry its own button. Which failures use it was not traced.                                                                                                                                         | Verified (component), inferred (coverage)    | `component/dialog-retry-action.tsx`                                |
| Sessions                      | `/sessions` (aliases `/resume`, `/continue`; also `<leader>l`): grouped by day ("Today"), filter by title, rename and delete from the list. Titles are generated on the server, not in the TUI.                                                                                                  | Verified (list), inferred (titles)           | `app.tsx:560-564`; `dialog-session-list.tsx:91, 261-349`           |
| Footer                        | Working directory, pending permission count, MCP count, and a `/status` hint. No model in the footer; the model sits under the prompt.                                                                                                                                                           | Verified                                     | `routes/session/footer.tsx:54-85`                                  |

Not read: the home route's tips, `which-key.tsx` rendering, how the server titles a session.

## Remy audit, before this change (as a new user, then a daily user)

Walked on the code at `829584f`: `npm i -g` -> `remy` -> model -> task -> approval -> question -> interrupt -> resume -> switch model -> errors.

Ranked friction, worst first:

1. **First `remy` with nothing connected exited with an error** (`Remy needs a model first. Run remy login...`). The new user had to quit, run another command, then start again. OpenCode opens the connect dialog instead.
2. **No way to switch model or provider in the chat.** Changing model meant leaving, setting `REMY_MODEL` or a flag, and losing the conversation. Saved logins were invisible once inside.
3. **Commands were undiscoverable.** Only `/help` existed; typing `/` showed nothing and there was no palette. The keys (Ctrl+O, `e`, `v`) were learnable only from the help text.
4. **No way to hand Remy a file.** The workspace is a hidden folder; the only route was describing a path in words and hoping `read_file` found it.
5. **Errors named the symptom, not the step.** Bad key, rate limit and offline all read "The model did not answer... Check your connection and key". A failed task ended with "see remy show <id>" even when the fix was `/login`.
6. **Anthropic and Gemini logins stored no default model**, so the next `remy` failed with "No model is chosen" after a successful login.
7. **The key prompt gave no place to get a key**, and the model question said "optional" when a model was required.
8. **The footer hint was static** (`Enter send . up recall . /help`) and did not follow state: not connected, a list open, a fresh conversation.

Still open after this change (ranked):

- `/sessions` lists only unfinished tasks; finished conversations cannot be reopened, and a session's name is its first prompt with no rename.
- No leader key or which-key help for chords; Ctrl+P and `/` cover the need today.
- The chat workspace is a throwaway folder under `~/.remy/workspaces`, so `@` finds nothing unless `--workspace` points at a real folder. A first-run hint for that is not built.
- A rate-limited or offline start is only found on the first message; there is no preflight, and no "recent models" or favourites in `/model`.
- No `/status` view (model, spend, workspace, saved logins) like OpenCode's.

## What was built

All in `apps/cli/src`; copy follows `branding/README.md` (outcome first, no hype, no exclamation marks).

| Change                                                                                                                                                                                                                                                                                     | Files                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| First run opens the login panel inside the chat; a message sent before connecting is kept and sent once a model is ready. Panel names the reason, links where to get a key.                                                                                                                | `chat.ts`, `login-ui.ts`, `login.ts`, `cli.ts`          |
| `/login`, `/model`, `/sessions` in the chat (`/connect`, `/models`, `/resume` stay as aliases). `/model` lists saved logins with catalog prices and context, marks the one in use, accepts any typed id, and switches without losing the conversation; the choice is saved as the default. | `chat.ts`, `chat-ui.ts`, `cli.ts`                       |
| `Ctrl+P` palette over one command registry, filtered as you type (ids match loosely, sentences as written).                                                                                                                                                                                | `commands.ts`, `picker.ts`, `chat-ui.ts`                |
| `/` autocomplete with descriptions under the prompt; Tab completes, Enter runs, arrows move.                                                                                                                                                                                               | `commands.ts`, `picker.ts`, `chat-ui.ts`                |
| `@path` completion in the workspace through `ScopedFs`, read-only. Referenced files are attached as fenced pasted segments, so the task is tainted and any non-read action asks first. The transcript shows the user's own words plus `Attached notes.txt.`                                | `mentions.ts`, `chat.ts`, `cli.ts`                      |
| Errors end with the one next step (`The key was rejected. Run /login to replace it.`; rate limit, credit, unknown model, offline).                                                                                                                                                         | `chat.ts`                                               |
| Footer hints follow state: not connected, list open, fresh chat, working. Default models for Anthropic and Gemini. `REMY_KEYCHAIN=off` for tests and servers.                                                                                                                              | `chat-ui.ts`, `login.ts`, `credentials` use in `cli.ts` |

Kept: every subcommand, `REMY_INPUT=single`, native scrollback (no alternate screen). The model is swapped under a stand-in `ModelClient`, so `core` is unchanged.

## Verification

- Unit and ink-testing-library: `ease.test.ts`, `ease-ui.test.ts`, `commands.test.ts`, `mentions.test.ts`, `picker.test.ts`.
- Live, with `apps/cli/scripts/pty-smoke.py --ease` (real pty into pyte, empty `REMY_HOME`, OpenAI): login panel on first run, pasted key hidden, connected, one turn, `/` list, Ctrl+P, `/model`, `@` completion with the model reading the attached file. Clean at 100x32 and 80x24, and with `REMY_INPUT=single`. Bad key: `The key was rejected. Run /login to replace it.`
