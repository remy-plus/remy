# Stage 5 brand directions

Three ways to carry the brand into the web app. All keep the existing ground rules: ASCII `REMY` logo, JetBrains Mono, ink/paper/stone, signal green as the only accent, voice rules in `README.md`. They differ in how much the web app leans on the terminal.

Reference: Cline. The app must look good in a 60 second screen recording.

## A. Terminal, grown up

The web app is the terminal with a roof on. Monospace everywhere, one column, the chat is a log. Tasks are lines that fill in. Approval cards are plain boxed blocks drawn with box characters.

- **Type:** JetBrains Mono for all text. No second face.
- **Colour:** ink background by default, paper in light mode. Signal green only for "done" and the cursor.
- **Motion:** typed-in results, a blinking block cursor while Remy works, nothing else.
- **Strength:** unmistakably Remy, cheap to build, matches the CLI exactly.
- **Risk:** reads as a developer tool. Harder for people who have never seen a terminal.

## B. Quiet paper

A calm reading surface. Paper background, generous space, mono only for the logo, task titles and numbers. Body text in a plain humanist sans.

- **Type:** JetBrains Mono for logo, labels and figures; a neutral sans (Inter or similar) for sentences.
- **Colour:** paper first, ink dark mode. Stone for secondary text. Signal green for completed work and the primary button.
- **Motion:** slow fades, a task row that settles when finished.
- **Strength:** friendliest to non-technical users, fits "stupidly simple to use", prints and screenshots well.
- **Risk:** loses some of the terminal identity; the logo has to carry it.

## C. Trace

Every task shows its working as a trace: a thin vertical line with a node per step (read, search, ask, done). The density ramp from the logo (`:` to `M`) becomes the progress language, light dots for pending, solid for finished.

- **Type:** mono for the trace and logo, sans for answers.
- **Colour:** ink or paper, stone line, signal node when a step completes.
- **Motion:** the line draws downward as steps land; approval cards sit on the line as a visible stop.
- **Strength:** makes the agent's work legible, which is the product's claim. Distinctive in a 60 second video.
- **Risk:** most design and build effort; the trace needs care to stay calm on long tasks.

## Recommendation

C for the task view, on top of B for everything else (settings, connections, memory). A stays the CLI. This is one direction, not three mixed; it is only a suggestion. The owner picks.

## Next step once picked

Design tokens from `branding/`, then browser prototypes of: first run, chat, a task at work, approval card, connections, skills, schedules, memory, settings, light and dark, phone size.

## Decision and canvas (2026-11-08)

Owner agreed with the recommendation: **C for the task view on top of B**. Design work is on the Doop canvas https://doop.design/c/ZuevZVY-Yl (tokens for light and dark, a `remy-brand` style guide, and the first screen, "Task at work, light"). Frames so far (all pass the first review; stone text is `#67655F` in light, see the `remy-brand` guide): task at work in light, task after approval in dark, first run, connections (with machines), memory in dark, task at work on a phone. Still to design: skills, schedules, settings, trust levels, an error state, and light or dark twins for each screen.

## ASCII imagery tool

Owner's pick for ASCII pictures: https://devault-ascii.pages.dev/ascii-generator/ . It turns an image or video into ASCII, braille, halftone, dither or brick art, runs in the browser (WebGL2, nothing uploaded), and exports JPEG, transparent WebP or MP4 with no watermark after a free sign-in. It needs a person at a browser, so Remy cannot run it: the owner exports into `branding/art/` and the web app uses the files. It makes pictures, not the logo. The `REMY` wordmark stays figlet Cosmike (see `README.md`). Use the Dither or Braille styles in ink and paper first; they fit the palette best.

## Owner feedback, 2026-11-08: "it does not feel like Jarvis"

The paper and trace screens read as a calm to-do app. Remy is meant to feel like a living intelligence that works ahead of you. Exploration on the canvas page "Jarvis exploration", frame "Home: Remy is awake (dark)". What changed in the idea, not just the look:

- **Home is a briefing, not an empty chat.** Remy speaks first: "Three things need you. Everything else is on track."
- **Parallel work is visible.** Four tasks run at once, each with a step rail, including one on a machine and one that only watches.
- **Remy notices things.** A feed of what it saw and did unasked, with nothing sent or spent without approval.
- **A living presence.** An animated ASCII ring built from the logo's density ramp (`.` to `M`), static under reduced motion.
- **Voice and a command bar** are always present.

Open question for the owner: dark by default for this direction, with the paper light theme kept as an option? The brand guide's "quiet confidence" still holds; the shift is from a document to an instrument.

## Jarvis exploration, round 2 (2026-11-08)

Owner liked the new direction: Remy as a second brain that does hard work, not a tidy task list. Frames on the canvas page "Jarvis exploration" (https://doop.design/c/ZuevZVY-Yl):

- **Home v2**: a live ASCII orb (canvas, binary texture, orbit ring, one labelled satellite per running task; static under reduced motion), a briefing, "Needs you", "Working now", "Noticed", a second-brain strip and a command bar with voice.
- **Demo A, second brain**: one question answered across email, Notion and files on home-server, with a source graph and a caught contradiction (£1.42M told, £1.38M reconciled). Sending the correction still asks first.
- **Demo B, hard task**: "Prepare the audit pack" split across four helpers (Reconciler on home-server, Researcher, Drafter, Checker), a plan, cost against a budget, problems found unasked, an activity log, and a draft pack. Send waits for approval after checks.

These are concept mockups with invented data. The product has notes and recall, helpers that act with approval, and `computer_run`, but no source graph and no live orb data yet. **The ASCII library (devault-ascii) is reference only**: its files are photo and 3D-render conversions in purple and blue, and downloads need a sign-in. The orb is drawn in code in Remy's own palette. Real library files, if wanted, go in `branding/art/` after a signed-in download.

## V1 screens, first full set (2026-11-08)

Page "V1 screens" on the canvas (https://doop.design/c/ZuevZVY-Yl), dark first, in the Jarvis direction the owner approved. All use the `remy-brand` rules (stone text `#67655F` in light, real buttons and links, one primary action per view).

1. First run: choose a model
2. Approval: send as you (desktop)
3. Connections and machines, with per-connection permissions
4. Skills, with a suggested skill and why one exists
5. Schedules and webhooks
6. Brain: notes graph and a selected note
7. Settings: trust, budget, memory, quiet mode, appearance
8. Overnight review (`remy review`)
9. A task that failed: one send, no blind retry, what the user can do
10. Quiet mode
11. Sign in to a home server
12. Push to talk
13. Command palette (⌘K)
14. Phone: Home
15. Phone: Approval sheet
16. Home in light

Earlier pages hold the first paper-and-trace screens, Home v2 and the two demos. Not yet drawn: the Tasks list, the add-connection and add-machine flows, empty states, notification settings, About, and light twins of every screen but Home. These are mockups with invented data. The Stage 5 gate is the owner's sign-off on these.
