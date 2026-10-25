# Remy brand

```
:::::::..    .,::::::    .        :     .-:.     ::-.
;;;;``;;;;   ;;;;''''    ;;,.    ;;;     ';;.   ;;;;'
 [[[,/[[['    [[cccc     [[[[, ,[[[[,      '[[,[[['
 $$$$$$c      $$""""     $$$$$$$$"$$$        c$$"
 888b "88bo,  888oo,__   888 Y88" 888o     ,8P"`
 MMMM   "W"   """"YUMMM  MMM  M'  "MMM    mM"
```

Remy doesn't need to tell people it's intelligent. It shows its value by getting things done.

**Quiet confidence. Extraordinary capability.**

## Personality

| Trait | What it means | What it doesn't mean |
|---|---|---|
| **Intelligent** | Understands what was meant, not just what was typed | Showing off, jargon, explaining its own cleverness |
| **Calm** | Even tone when things fail; no urgency it didn't earn | Cold or robotic |
| **Capable** | Finishes the job; the result is the proof | Promising more than it does |
| **Precise** | Exact numbers, exact names, exact next step | Hedging, filler, "might possibly" |
| **Human** | Warm and plain-spoken, like a trusted colleague | Fake enthusiasm, emoji, pretending to be a person |
| **Understated** | Lets the work speak; says less than it could | Hiding important information |

## Voice

- **Lead with the outcome.** "Booked: Tue 3pm with Dana." Not "Great news! I was able to…"
- **Short sentences, plain words.** If a 12-year-old can't follow it, rewrite it.
- **No hype words:** revolutionary, magical, supercharge, unleash, AI-powered, seamless, game-changing.
- **No exclamation marks** in product copy. Calm doesn't shout.
- **Say what happened and what's next.** On failure: what broke, what Remy already tried, what it needs from you.
- **Ask, don't assume,** before anything that spends money, sends as the user, or can't be undone.

| Instead of | Write |
|---|---|
| "🚀 Supercharge your workflow with AI!" | "Tell Remy what you need done." |
| "Oops! Something went wrong 😅" | "The airline site timed out. I'll retry in a minute." |
| "I'm thinking really hard about this…" | "Comparing 14 flights." |

## Taglines

- Primary: **Real work, quietly done.**
- Manifesto line: **Quiet confidence. Extraordinary capability.**

## Logo

The logo is the word `REMY` set in the figlet font **Cosmike**, with each letter spaced by hand (figlet's own kerning crashes them together). Its density rises from light `:` dots at the top to solid `M` at the base, the way a task goes from a question to a finished result. The `R` alone is the mark.

| File | Use |
|---|---|
| `logo/remy-wordmark.txt`, `logo/remy-mark.txt` | Source of truth. Terminals, the CLI banner, READMEs (inside a code block) |
| `logo/remy-wordmark-on-dark.svg` / `-on-light.svg` | Wordmark for websites, docs and slides |
| `logo/remy-mark-on-dark.svg` / `-on-light.svg` | Mark where space is square or tight |
| `github/avatar.png` (1024×1024) | GitHub org avatar and other profile pictures |
| `github/social-preview.png` (1280×640) | Repo social preview and link cards |

The SVGs are outlined paths, so they look the same without the font installed.

**How it's set:** JetBrains Mono **Bold**, line height **1.1** (tighter and the brackets collide with the next row). The ink brightens slightly from top to bottom (`#B9B6AF` → `#FFFFFF` on dark, `#4A4845` → ink on light), echoing the density ramp. Keep the ramp subtle: the top rows must stay readable. Where a gradient can't be used, flat paper or flat ink is fine.

**Rules:** keep the ASCII intact (don't edit characters or mix fonts), and leave clear space of at least two rows' height on every side. Don't add shadows, glows, outlines, color gradients or "AI sparkle" icons. On brand backgrounds, use ink with a soft central lift and fine grain (see `backdrop()` in `scripts/build.cjs`), never a busy image. Secondary lines like the tagline go in small, widely tracked capitals in `stone`. At very small sizes (under ~48px, e.g. favicons) the ASCII becomes texture; a simple favicon is still to do.

## Color

Mostly monochrome. The single accent is reserved for the cursor and for "done" states. If you're unsure whether to use it, don't.

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0F0F10` | Background (dark) and text (light) |
| `paper` | `#EDEBE6` | Text (dark) and background (light); warm, not pure white |
| `stone` | `#8C8A85` | Secondary text, taglines, metadata |
| `signal` | `#A8C49A` | Accent: cursor, completed states. Sparingly |

## Type

- **JetBrains Mono** (SIL Open Font License, included in `fonts/` with `OFL.txt`) for the logo, the CLI and any brand display text. Bold for the logo, Medium for text.
- The product UI can pair it with a neutral system sans for body text. Phase 1 will pick that.

## Regenerating the assets

```sh
cd branding/scripts
npm i --no-save figlet@1.8.0 opentype.js@1.3.4
node build.cjs     # ASCII + SVGs
./render.sh        # PNGs (needs Google Chrome)
```

Colors, sizes and the tagline live at the top of `scripts/build.cjs`.

## Use of the name and logo

The code is Apache-2.0. The Remy name and logo are not licensed with it. You may use them to refer to the project (for example, "built with Remy" or a link to this repo). Don't use them in a way that suggests your product, fork or service is Remy or is endorsed by the project.
