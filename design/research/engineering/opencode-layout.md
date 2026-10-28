# OpenCode TUI layout: buildable specs

Source: sst/opencode **v1.19.4**, `packages/tui/src` (paths below relative to it; `idx` = `routes/session/index.tsx`). Cline comparison: cline/cline **desktop-v0.0.48**, `apps/cli/src/tui`. Cells = terminal columns/rows. **V** = Verified (file:line read), **I** = Inferred. Prior notes (architecture, file map, OpenTUI choice) are in `opencode.md`/`cline.md` and not repeated.

## 1. Home screen

| Spec              | Value                                                                                                                                                                                                                                                                                                   | Status |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Outer box         | column, `alignItems=center`, `paddingLeft/Right=2`, `flexGrow=1` (`routes/home.tsx:76`)                                                                                                                                                                                                                 | V      |
| Vertical order    | flexible spacer (grow) / 4-row shrinkable spacer / **logo** / 1-row spacer / update notice / **prompt** (paddingTop 1) / tips slot / flexible spacer (grow) (`home.tsx:77-97`)                                                                                                                          | V      |
| Vertical position | block centered with the 4-row spacer biasing it slightly above middle (spacers shrink first on small terminals)                                                                                                                                                                                         | V      |
| Logo              | 4 rows x 39 cols (`logo.ts`: left word muted, right word bold text; `_ ^ ~ ,` marks become half-block shadows via `tint(bg, fg, 0.25)`; `component/logo.tsx:6-60`); `selectable=false`                                                                                                                  | V      |
| Prompt width      | `width=100%`, `maxWidth = 75` (config `prompt.max_width`; `"auto"` = `max(75, floor(termWidth*0.7))`) (`home.tsx:37-41,91`)                                                                                                                                                                             | V      |
| Placeholder       | `Ask anything… "<example>"`; examples: "Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests" (`home.tsx:20`, `prompt/index.tsx:1318`)                                                                                                                             | V      |
| Tips              | `paddingTop=3`, `maxWidth=75`, centered; one line `● Tip <text>` (warning-colored dot, muted text, highlight spans in `text` color), random tip per start; hidden when first-ever session and connected, or user toggled `tips.toggle` (`feature-plugins/home/tips.tsx:27,47`, `tips-view.tsx:151-160`) | V      |
| Footer (home)     | full width, `padding 1/1/2/2`, row, gap 2: `cwd:branch` (muted), `⊙ N MCP /status` if any, spacer, version (muted) (`home/footer.tsx:64-81`)                                                                                                                                                            | V      |
| Update line       | `/update to install vX` centered under logo, width = logo width, `/update` in primary (`home.tsx:107-148`)                                                                                                                                                                                              | V      |
| Toast             | bottom-anchored inside the same box (`home.tsx:98`)                                                                                                                                                                                                                                                     | V      |

```
 (100x30; each line below = 1 row; margins 2 cols each side)
 row  0-6   (flexible space, grows)
 row  7-10  (4-row spacer, shrinks first)
 row 11              █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█        <- logo, 39 wide, centered
 row 12              █  █ █  █ █^^^ █  █ █    █  █ █  █ █^^^
 row 13              ▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀
 row 14   (1 spacer)
 row 15   (blank = prompt paddingTop)        prompt: 75 wide, x=12..86
 row 16              ┃                                                         ┃? (left bar only)
 row 17              ┃  Ask anything… "Fix broken tests"                       
 row 18              ┃                                                         
 row 19              ┃  Build · gpt-5-nano  OpenAI                             
 row 20              ╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  (half-block bottom pad)
 row 21              (under box, home: empty hint)            ctrl+p commands   <- agents/commands hints right-aligned
 row 22-24  (3 rows) ● Tip Type @ followed by a filename to fuzzy search and attach files
 row 25-27  (grows)
 row 28     (blank)
 row 29     ~/proj:main            ⊙ 2 MCP /status                       1.19.4   <- footer, padding 1 top/bottom
```
(ASCII approximates; the prompt panel has NO top/right/bottom border, only a left `┃` bar plus a filled `backgroundElement` panel.)

## 2. Session screen

| Spec                               | Value                                                                                                                                                                                                                                                                                                                                                | Status |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Structure                          | root row: [main column flexGrow] + [sidebar]. Main column: `paddingLeft=2 paddingRight=2 paddingBottom=1 gap=1`; children: **scrollbox (flexGrow)**, bottom `box flexShrink=0` (permission OR question OR prompt), Toast. **No header, no footer row**: status lives under the prompt (`idx:1111-1262`)                                              | V      |
| Message width                      | `contentWidth = termWidth - (sidebar ? 42 : 0) - 4`; no max width (full available) (`idx:274`)                                                                                                                                                                                                                                                       | V      |
| Scrollbox                          | `stickyScroll stickyStart="bottom"`; first child is a 1-row spacer; scrollbar hidden by default (`scrollbar_visible=false`, `paddingLeft 1` when shown) (`idx:1113-1135,257`)                                                                                                                                                                        | V      |
| Scroll amounts                     | wheel: fixed **3 rows/tick** (`CustomSpeedScroll(3)`) or `MacOSScrollAccel` if enabled (`util/scroll.ts:18-26`). Page up/down = `height/2`; half-page = `height/4`; line = 1; first/last = `scrollTo(0)` / `scrollTo(scrollHeight)` (`idx:688-762`). New submit calls `toBottom()` (`idx:312`, `scrollBy(100_000)`)                                  | V      |
| Sidebar                            | `width=42`, `backgroundPanel`, `padding 1/1/2/2`, own scrollbox; shown if `termWidth > 120` and setting `auto` (persisted `sidebar` kv), or toggled open; **below 120 it is an overlay**: absolute full-screen `rgba(0,0,0,70)` backdrop, sidebar right-aligned. Hidden for child (subagent) sessions (`idx:254-276,1260-1290`; `sidebar.tsx:27-35`) | V      |
| Sidebar content (order)            | title (bold) / Context (`N tokens`, `P% used`, `$X spent`; order 100) / MCP / LSP (collapsible with ▶▼ when >2) / Todo (order 400, only if unfinished) / Modified files (order 500) ; pinned footer: `• OpenCode <version>` (`feature-plugins/sidebar/*.tsx`)                                                                                        | V      |
| Footer (under prompt)              | one row, see section 4                                                                                                                                                                                                                                                                                                                               | V      |
| Legacy `routes/session/footer.tsx` | defined (cwd, `△ N Permissions`, `• N LSP`, `⊙ N MCP`, `/status`) but not imported by `idx`                                                                                                                                                                                                                                                          | V      |

```
 (100x30, no sidebar; width 100 <= 120)                             padding: 2 cols L/R, 1 row bottom
 ┌─ scrollbox (flexGrow) ────────────────────────────────────────────────────────────────────────┐
 │                                                                                               │ row 0 spacer
 │  ┃  fix the failing test                                         <- user: left bar, panel bg │
 │  ┃                                                                                            │
 │     Looking at the test file first.                              <- assistant text, indent 3 │
 │                                                                                               │
 │     → Read src/a.test.ts                                         <- inline tool, indent 3     │
 │     $ pnpm test                                                                              │
 │  ┃ ⠋ pnpm test  (block: panel bg, output 10 lines then "Click to expand")                    │
 │     ▣ Build · gpt-5-nano · 12s                                   <- message footer           │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
        (gap 1 row)
   ┃  panel: padding 2 L/R, 1 top                                                  <- prompt (96 wide)
   ┃  textarea (min 1, max max(6, floor(h/3)) rows)
   ┃
   ┃  Build · gpt-5-nano OpenAI                            right slot
   ╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    ⠋⠋ esc interrupt                         |  ~/proj          12,345 (23%) · $0.12   ctrl+p commands
```

## 3. Message rendering

| Element         | Spec                                                                                                                                                                                                                                                                                                                                                                                                      | Status |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| User message    | outer box: left border `┃` in agent color (`SplitBorder`, `ui/border.ts:15`), `marginTop=1` (0 for first); inner: `backgroundPanel` (hover: `backgroundElement`), `paddingTop/Bottom=1`, `paddingLeft=2`, `text` color; file chips: `File` (secondary bg) + muted name; click opens message dialog (`idx:1334-1395`)                                                                                      | V      |
| User meta       | optional timestamp (muted, `timestamps` kv default hide); queued messages show `QUEUED` badge (agent bg, bold)                                                                                                                                                                                                                                                                                            | V      |
| Assistant text  | markdown, `paddingLeft=3`, `marginTop=1`, no background, `markdownText`; `streaming=true`, tables `grid`, `conceal` on (`idx:1565-1582`)                                                                                                                                                                                                                                                                  | V      |
| Spacing         | blocks get `marginTop=1`; consecutive inline tool rows get 0 margin unless previous sibling is taller than 1 row or in `alwaysSeparate` (then 1) (`idx:1822-1830`)                                                                                                                                                                                                                                        | V      |
| Inline tool row | `paddingLeft=3`; row = icon (width 2) + text. Icons: bash `$`, write/edit `←`, read/skill/question `→`, glob/grep `✱`, webfetch `%`, websearch `◈`, task/todo `⚙`. Running: spinner + text; pending (no args yet): `~ Writing command…`. Done: `textMuted`; running: `text`; permission pending: `warning`; failed: `error` (click toggles error text); denied: strikethrough (`idx:1771-1900,2032-2512`) | V      |
| Block tool      | for bash with output, write, edit, patch: left border colored `background` (invisible), `backgroundPanel`, `padding 1/1/2`, `marginTop=1`, `gap=1`; title line `# Running in dir` / `# Wrote path` (muted, paddingLeft 3); error text below in `error` (`idx:1900-1960`)                                                                                                                                  | V      |
| Bash output     | `$ cmd` in `text`; output collapsed to 10 lines / `10*(width-6)` chars then `…`; footer `Click to expand/collapse` (muted) (`idx:1990-2020`, `util/collapse-tool-output.ts`)                                                                                                                                                                                                                              | V      |
| Thinking        | hide mode (default): one line `+ Thought: <bold-title> · 3s` in `warning` color (dimmed by `thinkingOpacity` when open); while running spinner `Thinking: <title>`; click expands markdown body (muted, indent 2) (`idx:1500-1630`)                                                                                                                                                                       | V      |
| Error           | left bar `error`, `backgroundPanel`, padding 1/1/2, `marginTop=1`, text muted (`idx:1470-1485`)                                                                                                                                                                                                                                                                                                           | V      |
| Message footer  | shown for last assistant msg or final: `▣ Build · model · 12s` (`▣` agent color, mode `text`, rest muted; `· interrupted` when aborted, glyph muted); duration = completed - parent user created (`idx:1488-1520`)                                                                                                                                                                                        | V      |
| Compaction      | `border=top` with centered title `Compaction`, `borderActive` (`idx:1380`)                                                                                                                                                                                                                                                                                                                                | V      |
| Running state   | whole turn: prompt-footer spinner (section 4) + per-tool spinners; completed turns show no spinner                                                                                                                                                                                                                                                                                                        | V      |

## 4. Prompt box

| Spec              | Value                                                                                                                                                                                                                                                                                                                                                                                                           | Status |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Border            | none top/right/bottom. Left `┃` (agent color, tinted toward `border` via fade-in); filled `backgroundElement` panel; bottom edge faked by 2 rows: `╹` + `▀` row in `backgroundElement` (`prompt/index.tsx:1352-1366,1486-1512`)                                                                                                                                                                                 | V      |
| Padding           | panel `paddingLeft/Right=2`, `paddingTop=1`; meta row `paddingTop=1`; no bottom padding (the `▀` row closes it)                                                                                                                                                                                                                                                                                                 | V      |
| Height            | textarea `minHeight=1`, `maxHeight = prompt.max_height ?? max(6, floor(termHeight/3))`, grows with wrapped lines (`:1325,1375-1376`)                                                                                                                                                                                                                                                                            | V      |
| Meta row (inside) | left: `Build` (agent color) `·` model (text) provider (muted) `· <variant>` (warning bold); `Shell` in shell mode (`!` prefix); right: `props.right` slot. Items fade in with alpha animation (`createFadeIn`)                                                                                                                                                                                                  | V      |
| Under-box row     | left: running -> braille-block spinner (40 ms interval, `marginLeft 1`) + `esc interrupt` (turns primary `esc again to interrupt` after first press); retry text in `error` with countdown; idle -> cwd (muted). Right: `12,345 (23%) · $0.12` (context tokens, %, cost; muted) else `<tab> agents`; always `ctrl+p commands` (key text `text`, label muted) (`:1514-1690`)                                     | V      |
| Placeholder       | `Ask anything… "<rotating example>"`, shell: `Run a command… "ls -la"`, muted                                                                                                                                                                                                                                                                                                                                   | V      |
| Keys              | Enter submit; newline = shift+enter / ctrl+enter / alt+enter / ctrl+j; history up/down (50 entries, `prompt-history.jsonl`, `prompt/history.tsx:27`); ctrl+u/k/w/a/e readline-style; ctrl+v paste (image-aware); `!` at start enters shell mode; double `esc` interrupts (`config/keybind.ts:161-199`)                                                                                                          | V      |
| Paste             | normalizes CRLF; if >=3 lines or >150 chars becomes virtual text `[Pasted ~N lines]` (extmark, expanded on submit/copy); file paths / images become file parts (`prompt/index.tsx:1206-1211`)                                                                                                                                                                                                                   | V      |
| Autocomplete      | absolute popup **above** the prompt: `top = anchor.y - height`, same `left/width` as prompt, `zIndex 100`, left+right `┃` borders in `border`, bg `backgroundMenu`, height `min(10, rows, anchor.y)`; row: `paddingX 1`, selected = `primary` bg + `selectedForeground`; label + muted description; `No matching items`; triggers `@` (files/agents, fuzzysort) and `/` (commands) (`autocomplete.tsx:717-781`) | V      |

## 5. Dialogs

| Spec            | Value                                                                                                                                                                                                                                                                                                                                                                                                               | Status |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Overlay         | absolute full screen, `zIndex 3000`, backdrop `rgba(0,0,0,150)` (~59% black), content `alignItems=center`, `paddingTop = termHeight/4` (`ui/dialog.tsx:36-48`)                                                                                                                                                                                                                                                      | V      |
| Panel           | width **60** (medium) / **88** (large) / **116** (xlarge), `maxWidth = termWidth-2`, `backgroundPanel`, `paddingTop 1`; click outside closes (`dialog.tsx:21-62`)                                                                                                                                                                                                                                                   | V      |
| DialogSelect    | title bold left + `esc` muted right (`paddingX 4`); search `input` below (`paddingTop 1`, placeholder "Search", cursor `primary`); list `paddingX 1`, `maxHeight = min(rows, floor(termH/2) - 6)`; category header `accent` bold (`paddingTop 1, paddingLeft 3`); item `paddingRight 3`, active = `primary` bg + bold; description muted; footer actions row (`paddingLeft 4`) (`ui/dialog-select.tsx:213,558-730`) | V      |
| Keys            | up/down 1, pageup/down 10, enter select, esc close, mouse hover/click                                                                                                                                                                                                                                                                                                                                               | V      |
| Command palette | `DialogSelect title="Commands"`, ctrl+p (`component/command-palette.tsx:78`)                                                                                                                                                                                                                                                                                                                                        | V      |
| Model picker    | `DialogSelect` with provider groups, favorites (ctrl+f), provider list (ctrl+a); Sessions list = `DialogSelect title="Sessions"` (ctrl+r rename, ctrl+d delete, ctrl+f pin)                                                                                                                                                                                                                                         | V      |

## 6. Permission and question prompts

| Spec               | Value                                                                                                                                                                                                                                                                                                                                                                   | Status |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Placement          | replaces the prompt in the bottom slot (not an overlay; scrollbox shrinks). Permission wins over question wins over prompt (`idx:1236-1262`)                                                                                                                                                                                                                            | V      |
| Permission panel   | `backgroundPanel`, left `┃` in `warning`, `maxHeight 15` (fullscreen toggle: absolute, inset 2); header `△ Permission required` (`warning` glyph) + `<icon> <title>` (e.g. `$ command`, `Edit path` with diff); body padding `1 / 1 / 3` (`permission.tsx:~385-400,590-640`)                                                                                            | V      |
| Permission buttons | strip on `backgroundElement` (padding 1/2/3/1): `Allow once` `Allow always` `Reject` as `label` chips; selected = `warning` bg, others `backgroundMenu` + muted; hint right: `⇆ select  enter confirm`; stacks vertically when narrow. Keys: left/right or h/l, enter, esc = reject (Reject opens message textarea, left bar `error`); Always allow asks Confirm/Cancel | V      |
| Question panel     | same shape with left bar `accent`; tab strip of question headers + `Confirm`; options `1. Label` with `✓` for picked, description muted at indent 3, "Type your own answer" textarea (maxHeight 6); keys: up/down, left/right, tab/shift+tab, enter (`question.tsx:291-495`)                                                                                            | V      |

## 7. Keybindings (leader = `ctrl+x`, timeout 2000 ms)

Source `config/keybind.ts`, `config/index.tsx:21`.

| Action                   | Keys                           |     | Action      | Keys                         |
| ------------------------ | ------------------------------ | --- | ----------- | ---------------------------- |
| Commands                 | ctrl+p                         |     | Models      | `<leader>m`, F2 cycle recent |
| New / list sessions      | `<leader>n` / `<leader>l`      |     | Agent cycle | tab / shift+tab              |
| Sidebar                  | `<leader>b`                    |     | Interrupt   | esc (twice)                  |
| Exit                     | ctrl+c, ctrl+d, `<leader>q`    |     | Clear input | ctrl+c                       |
| Page up/down             | pageup/pagedown, ctrl+alt+b/f  |     | Half page   | ctrl+alt+u/d                 |
| First / last msg         | ctrl+g, home / ctrl+alt+g, end |     | Line        | ctrl+alt+y/e                 |
| Undo / redo / copy msg   | `<leader>u` / `r` / `y`        |     | Compact     | `<leader>c`                  |
| Themes / editor / status | `<leader>t` / `e` / `s`        |     | Newline     | shift+enter, ctrl+j          |
| Rename / delete session  | ctrl+r / ctrl+d (in list)      |     | Variant     | ctrl+t                       |

## 8. Theme keys (`theme/index.ts:28-92`; opencode dark: bg `#0a0a0a`, panel `#141414`, element `#1e1e1e`, border `#484848`/active `#606060`/subtle `#3c3c3c`, primary `#fab283`, text `#eee`, muted`#808080`)

`primary` selection/active/focus; `secondary` file chips, picked option; `accent` category headers, question bar; `error` `warning` `success` `info` status; `text` `textMuted` `selectedListItemText`; `background` page; `backgroundPanel` user msg, sidebar, dialogs, block tools; `backgroundElement` prompt panel, hover, buttons strip; `backgroundMenu` popup/list; `border` `borderActive` `borderSubtle`; `diff*` (added, removed, context, hunkHeader, highlight*, *Bg, lineNumber); `markdown*` (text, heading, link, linkText, code, blockQuote, emph, strong, hr, listItem, listEnumeration, image, imageText, codeBlock); `syntax*` (comment, keyword, function, variable, string, number, type, operator, punctuation); `thinkingOpacity`. Agent colors come from `local.agent.color(name)`.

## 9. What makes it feel smooth

- 60 fps cap, native diffing renderer, `useKittyKeyboard`, mouse on (`app.tsx:179-185`) V. `externalOutputMode: "passthrough"`. Alternate screen: **I** (OpenTUI default; not in this repo).
- Fine-grained signals: a streamed token updates one markdown node, no tree re-render; `streaming={true}` markdown/code (`idx:1575`) V. No explicit debounce found V (absence).
- Fixed 3-row wheel step, sticky-bottom scrollbox that only follows when already at the bottom (`stickyScroll`) V.
- Spinners: braille `⠋…⠏` at 80 ms for tools; block-gradient spinner at 40 ms for the turn; `animations_enabled` kv falls back to `⋯` / `[⋯]` V (`component/spinner.tsx`, `prompt/index.tsx:1520`).
- Prompt meta fades in (alpha tween) and border tints toward the agent color V (`createFadeIn`, `:1300`). Layout never shifts: collapsed thinking is one line (`idx:1503` comment) V.
- Mouse hover on clickable rows changes bg/fg only (no layout change) V. Double-defer submit for IME (`prompt/index.tsx:1391`) V.

## Cline differences worth taking

- Home is full-height centered column (`views/home-view.tsx:88-98`): mascot, bold "What can I do for you?", gray italic hint `Use / for slash commands, @ for file mentions, Ctrl+P for menu`, content width capped at **68** (`types.ts:253`). V
- Input bar is ruled, not filled: `border={["top","bottom"]}` single line in a rule color, `maxHeight 5` (`input-bar.tsx:200-235`). Works on terminals without good bg contrast. V
- Status bar under input: Plan/Act toggle (Tab), context bar from block glyphs, git `+N -N`, auto-approve state with Shift+Tab (`status-bar.tsx:233-278`). V
- Chat list: `paddingX 1, paddingY 1, gap 1` on a column inside `scrollbox stickyScroll stickyStart=bottom` (`chat-message-list.tsx:88-98`); reasoning shows `Thinking...` italic gray + dots spinner, expandable. V
- Rounded bordered cards for errors (red), plan (plan accent) and completion (`chat-entry.tsx:288-487`): good for result summaries. V
- Approval renders in the input slot (InlineToolResponse) with `[y] Approve` / `n`/Esc deny (`chat-view.tsx:96-110`, `inline-tool-response.tsx`). Same placement as OpenCode. V
- Autocomplete dropdown sits above the input, max 7 rows (+2 for border) (`autocomplete-dropdown.tsx:8`). V
- Scroll keys mirror OpenCode: half page, quarter page, top, bottom (`chat-message-list.tsx:45-60`); scroll-to-bottom is retried on microtask and timeout (`:76-85`) to beat late layout. V
- Queued prompts rendered above the input and editable (`queued-prompts.tsx`). V
- Pasted text collapses at 5+ lines (OpenCode: 3 lines or >150 chars). V (prior note)
