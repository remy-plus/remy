# Remy on the web: look and motion

How remy.plus and the web app look and move. The code that does it is in this folder; the site
(`apps/site`) and the app (`apps/web`) use copies that a test keeps identical.

## The look

- **Ink, paper, stone.** Backgrounds are ink, text is paper, quiet text is stone. Surfaces step up in tone
  (`--surface`, `--raise`) instead of using lines. Edges, where they are needed, are paper at 8% or 16%
  (`--edge`, `--edge-hi`), never a hard grey border.
- **One accent, signal green, in three places only:** the blinking cursor, live dots and finished steps.
  It is never a button fill and never a selected state. The primary button is **paper on ink**, a pill.
- **The logo is the brand's own.** The wordmark is the picture on the first screen, from
  `logo/remy-wordmark-on-dark.svg` and the characters in `logo/remy-wordmark.txt`. Never retype it as
  plain text. The mark (`remy-mark-on-dark.svg`) is for tight places.
- **Type.** Instrument Sans for the page and the app, JetBrains Mono for the wordmark, code, times and
  costs. Headings are medium weight with tight tracking; buttons and navigation are sans, not mono.
- **Voice.** Outcome first, no hype, no exclamation marks (see the main guide).

## The ASCII motion (`ascii.js`)

Two small canvas pieces, no libraries, on every first impression (landing hero and footer, first-run and
sign-in screens):

1. **`createAsciiMark`** draws the wordmark from its own characters. It *decodes in* from scrambled glyphs,
   row by row and left to right, each glyph flashing as it lands. It then *shimmers*: a slow band of light
   drifts across and a rare glyph twinkles. Under the pointer, glyphs *heat up* into denser characters
   (`.:;+=*%#@$8MW&`) and cool back. At rest it is the exact ASCII, character for character.
2. **`createDotField`** is a quiet halftone field of dots that flows and swells around the pointer. It sits
   behind the wordmark and is faded at its edges by a mask. Keep it faint behind text (opacity 0.3 to 0.55).

Both pause off screen and when the tab is hidden. If motion is reduced, or the canvas is missing, the static
SVG wordmark stays and nothing animates. The SVG is always kept for screen readers; the canvases are hidden
from them.

## The scroll feel (`smooth.js`, site only)

Weighted, like a lid that opens slowly. The wheel pushes a target and the page glides to it (about a second
and a half to settle), so one notch never jumps. Anchor links travel on a quartic ease over 0.9 to 2.2 s and
land exactly. Keyboard, the scrollbar, touch and inner scrollers stay native. Scroll-linked touches: the
wordmark drifts slower than the page and fades, the product frame scales from 93% to 100% as it arrives,
and a 2 px hairline shows progress. The web app keeps native scrolling on purpose: it is a tool.

## Motion rules

- One easing: `--ease-soft` (expo-out). Durations: `--dur-fast` 0.3 s for hovers, `--dur` 0.6 s for
  entrances, `--dur-slow` 1.1 s for large reveals. Stagger siblings by 70 to 110 ms.
- Only transform, opacity and clip-path move. Nothing shifts layout.
- Every move has a reduced-motion fallback that keeps the content and drops the travel.
- A finished step pops; a new step rises; a page rises in. A button presses to 97%.

## Files

| File | What |
|---|---|
| `ascii.js` | `createAsciiMark`, `createDotField`, `countUp` |
| `smooth.js` | `smoothScroll` (wheel weight, anchor glide) |
| `motion.css` | Keyframes and classes for the app's entrances |
| `../tokens.css` | Colours, edge tones, easing and durations |
| `../logo/*` | The wordmark and mark, as SVG and as characters |
