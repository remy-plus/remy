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
