# Web app v1: the redesign (decided 2026-11-10)

The owner's vision: **Remy is Jarvis, a person on your computer.** You talk to it; it can do pretty much anything; you glance at what it is doing when you want to. The current app is a task tool with a header of tabs, military time and words like "Trust: ask". That is the wrong product. This document is the brief for the rebuild. Follow the brand rules in `branding/web/README.md` (monochrome, paper-on-ink pills, accent only for cursor, live dots and finished steps, soft edges, slow soft easing, reduced-motion fallbacks).

Reference: Hearth (greeting, one big input card, slim rail and chat history), the owner's Jarvis video (voice first: you say it, Remy answers in a few words, screens show the work), Grok and Claude (calm, empty, confident), Claude's thinking sparkle (a small living mark that moves while it works).

## Principles

1. **One conversation is home.** Opening the app puts you in a chat with Remy: a greeting, a big input, a living mind above it. No "Tasks" page as the front door. A job Remy does is just something that happened in the chat.
2. **Simple by default, power on demand.** Two layouts: **Simple** (chat, voice, a floating dock) and **Command center** (chat plus a stage that shows live work). The stage also slides in by itself in Simple when Remy works on something visual. The person picks in Settings; first run offers a choice in plain words.
3. **Plain words everywhere** (table below).
4. **Alive.** The Mind (ASCII, like the landing page) shows what Remy is doing: resting, listening, thinking, working, waiting for you, done.
5. **Show the work, simply.** A plain-language feed in the chat ("Reading your quotes", "Opening the Northwind site"); tap a line for details. A live Browser panel mirrors Remy's own browser, with a button to take over for sign-ins.
6. **Voice.** A talk button next to the input. Push to talk (Space) and tap-to-talk. Remy can speak short replies. Voice states drive the Mind.
7. **A floating top dock**, centered, small, customizable. Never a wall of tabs.

## Information architecture

- **Dock (top, floating, centered):** Chat, Activity, Browser, Brain, Connections, Settings. A clock-less status dot on the left (Remy is resting or working), a History button and a New chat (+) on the right.
- **Customizable:** in Settings, "Your dock": show or hide each item and reorder them (up and down buttons; drag is a bonus). Stored per person (server `web-prefs.json`, key `dock`). Chat and Settings cannot be hidden.
- **History:** a drawer from the left listing chats (Today, Yesterday, Earlier). Rename and delete. Never shows internal ids.
- **Activity:** everything Remy is doing or did, across chats: working now, waiting for you, done. This is the old Tasks list, made simple. Each row opens its chat.
- **Browser:** the live view of Remy's browser (phase 2).
- **Brain:** what Remy knows (notes), skills, schedules. Keep what exists, simplify the words.
- **Connections** and **Settings:** keep, simplify.
- Routes: `/` (new chat), `/chat/:id`, `/activity`, `/browser`, `/brain`, `/connections`, `/settings`. Old routes (`/tasks`, `/tasks/:id`, `/review`) redirect.

## Plain words (use these; search the app for the left column)

| Instead of                        | Say                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tasks, a task                     | Chats, Activity; "a job" when you must name one                                                                       |
| Trust: ask / steady / away        | **How much Remy does on its own:** "Check with me first" / "Handle routine things" / "Work on its own while I'm away" |
| Needs your OK, Review and approve | "Waiting for you", "Take a look" then **Approve** / **Not now**                                                       |
| Quiet: off, 'asks' pills          | Say what it does, or hide it                                                                                          |
| 18:40:12, military time anywhere  | "just now", "2 min ago", "yesterday"; if a clock is unavoidable, 12-hour via `Intl.DateTimeFormat`                    |
| Step 3, argsHash, tool names      | Plain verbs: "Reading", "Writing", "Searching", "Opening"                                                             |
| Running / waiting_approval        | Working / Waiting for you                                                                                             |
| Budget, per-task stop             | "Spending", "Stop a job at"                                                                                           |
| Stopped without finishing         | "Didn't finish" with a Try again button                                                                               |

Voice rules from the brand guide still hold: outcome first, no hype, no exclamation marks.

## The Mind (the sparkle)

A canvas component, `MindGlyph`, in the same ASCII language as the landing page (glyph ramp `.:;+=*%#@$8MW&`, row-by-row brightness, pointer heat optional). A small cluster (about 120 px) in the dock status dot and a large one (about 220 px) above the chat input. States: `rest` (slow breathing, sparse), `listening` (reacts to a `level` 0 to 1 from the microphone), `thinking` (glyphs scramble inward, quick), `working` (a ring of glyphs orbits a steady core), `waiting` (holds still, one glyph blinks like a cursor), `done` (a short flash settles to rest). Transform and opacity only where possible; pauses off screen and in hidden tabs; static under reduced motion.

## Chats on the server

A chat is an ordered list of jobs (tasks) with a title. Storage: `REMY_HOME/chats.json` (0600, written atomically), a small module `serve-chats.ts`. Routes (all behind the token):

- `GET /api/chats` returns `{ chats: [{ id, title, updatedAt, preview, state }] }`, newest first; `state` is `working | waiting | resting`.
- `GET /api/chats/:id` returns `{ id, title, turns: [{ taskId, prompt, state, answer?, at }] }` built from the tasks.
- `POST /api/chats/messages` body `{ chatId?: string, text: string, trust?: string }`. Creates the chat if `chatId` is missing (title from the first message, trimmed to a short plain phrase). Starts a job for `text` with `config.context` set to the chat's earlier finished turns (last 10 turns or about 8,000 characters, oldest first, `{ prompt, answer }`), appends the new task id to the chat, and returns `201 { chatId, taskId }`. It must go through the same `beforeStart` monthly-budget check as `POST /api/tasks`.
- `PUT /api/chats/:id` body `{ title }`; `DELETE /api/chats/:id` removes the chat record only (jobs stay in Activity).
- `POST /api/tasks` keeps working unchanged.

## Work packages

| WP  | What                                                                                                                                     | Owner              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | `MindGlyph` component with states, tests, a demo state switcher in the dev page                                                          | helper             |
| 2   | Server chats (above) with tests; web `RemyApi` + mock + http adapter methods                                                             | helper             |
| 3   | Shell: floating dock, History drawer, routes and redirects, status dot                                                                   | owner of this file |
| 4   | Chat home and chat view: greeting, input card, feed, inline approval cards, suggestions                                                  | owner of this file |
| 5   | Language and time sweep over every screen (table above)                                                                                  | helpers, by area   |
| 6   | Customizable dock in Settings; layout choice (Simple, Command center); simplified Settings                                               | helper             |
| 7   | Voice: talk button, listening level to the Mind, optional spoken replies                                                                 | helper             |
| 8   | Live Browser panel: `browser.screenshot()` in `packages/browser`, `GET /api/browser/frame` and `/api/browser/state`, the pane, take over | helper             |
| 9   | Command center layout with the stage                                                                                                     | later              |

Gates for every package: `pnpm check` green, replay unchanged, brand rules kept, reduced-motion fallback, 320 px and 1440 px checked in a real browser. Commit small and often.

## The twelve things that make an app feel cheap (2026-11-10)

The owner's note: the app still felt cheap, and it was not only about design. This is the checklist every
screen is held to from now on, taken from the twelve mistakes in the reference video. The shared pieces
that make it cheap to follow live in `apps/web/src`:

| #   | Rule                                                           | Where it lives in code                                                                 |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Say where a person's data goes, where they hand something over | `pages/welcome/SignIn.tsx` (chats, keys and files stay on your server)                 |
| 2   | No dead ends: every empty state has a way forward              | `pages/activity/Activity.tsx`, `components/BrowserPane.tsx`, `pages/connect/Brain.tsx` |
| 3   | Helper text on any control whose effect is not obvious         | `pages/settings/controls.tsx` (`Row`), the composer's trust line                       |
| 4   | A success state after anything that can fail                   | `pages/chat/ApprovalInline.tsx`, `pages/settings/Settings.tsx` (`useSaveState`)        |
| 5   | Specific errors, never "something went wrong"                  | `lib/errors.ts` (`describeError`, `statusMessage`), used by the http adapter           |
| 6   | Loading that names the thing                                   | `components/Skeleton.tsx` (`label`), `pages/connect/ui.tsx` (`Loading`)                |
| 7   | Never ask for what the app already knows                       | the front door offers the newest chat (`pages/chat/Chat.tsx`)                          |
| 8   | One icon set                                                   | `components/Icon.tsx` (16 px, 1.6 stroke, round caps)                                  |
| 9   | Buttons say what happens                                       | "Save and continue", "Check the model", "Ask Remy", "Create the schedule"              |
| 10  | No permission prompt before value                              | the microphone is asked for on the talk button, never on load                          |
| 11  | Filters and searches reset in one click                        | `pages/connect/Brain.tsx` (Clear, and Clear the search in the empty state)             |
| 12  | Never truncate text that matters for a decision                | suggestions wrap; approval text and failure reasons wrap                               |

Rules for new screens: import `describeError` for every catch, `Skeleton` with a label for every wait,
`Icon` for every mark, and give every empty state one sentence and one button.
