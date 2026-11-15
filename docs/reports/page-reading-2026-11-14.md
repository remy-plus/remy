# Page reading: the article first, not the menus (2026-11-14)

## Problem

A research task ("best budget noise cancelling headphones") opened soundguys.com, tomsguide.com, itechguides.com and whathifi.com. `fetch_url` returned `htmlToText` output: menus, sign-in links and banners ahead of the article, so the default 6,000-character cap cut the real content and Remy fell back to search snippets.

## Change

`packages/tools/src/article.ts` (pure TypeScript, no new dependency):

1. A forgiving HTML tree (unclosed `li`, `p`, `td`, stray close tags, `>` inside attribute values).
2. Furniture is pruned: `nav`, `footer`, `aside`, `button`, `select`, `dialog`, `header` outside an article, `role` of navigation, banner, contentinfo, complementary, search and dialog, hidden elements, and any element whose class or id has a word such as nav, menu, footer, cookie, consent, newsletter, share, related, sidebar, breadcrumb, promo, banner, popup. An element that contains the article is never removed on its name alone.
3. The pick: the largest `article`, `main` or `[role=main]` by non-link text; otherwise the block with the most prose (paragraph scoring, discounted by link density).
4. Rendering: `#` headings, `-` list items, table rows as `a | b`, unlabelled walls of links dropped (a row of linked prices is kept), one-line leftovers such as "Share this article" dropped.
5. The result starts with the page title. Under 500 characters picked, it falls back to the whole-page `htmlToText`, so nothing is lost on unusual pages.

`fetch_url` now uses it for HTML. `htmlToText` is unchanged (the browser fixtures and evals still use it). Trust handling is unchanged: the output is `untrusted` as before.

## Measure

Fixtures are real pages fetched on 2026-11-14 and trimmed (scripts, styles, svg, most attributes removed; two of them cut at 140 KB). The metric is a proxy: the share of the first 3,000 characters on lines that look like content, meaning at least 8 words or a price. Menu items are one to four words, so they do not count. Headings and short product-name lines are not counted either, which understates the new output.

| Fixture                                   | Before (htmlToText) | After (articleText) | Text length before / after |
| ----------------------------------------- | ------------------- | ------------------- | -------------------------- |
| soundguys.com, best budget ANC under $150 | 48%                 | 81%                 | 31,866 / 23,184            |
| tomsguide.com, best cheap headphones      | 33%                 | 86%                 | 28,242 / 16,241            |
| itechguides.com, budget over-ear picks    | 25%                 | 98%                 | 26,626 / 19,361            |
| whathifi.com, best cheap ANC headphones   | 4%                  | 84%                 | 31,527 / 19,648            |
| theguardian.com, news article             | 46%                 | 96%                 | 7,865 / 5,084              |
| developer.mozilla.org, docs page          | 24%                 | 92%                 | 9,760 / 3,830              |
| apple.com, product page (AirPods Max 2)   | 70%                 | 77%                 | 27,622 / 3,974             |

On What Hi-Fi the first 1,500 characters before were the site menu ("Hi-Fi speaker reviews", "Sign out"); after, they are the headline and the introduction, and the first ranked model (Sony WH-CH730N, with specifications) is inside 3,000. The Apple page keeps the colour and price rows ($549.00).

Tests (`packages/tools/src/article.test.ts`) assert for each fixture that the first 1,500 characters hold the real content and the first 3,000 hold none of a list of menu strings, plus unit tests for the parser, noise rules, link density, the pick, rendering and the fallback.

## Not tested

- Pages that need JavaScript to show their content (those still go to the reader or the browser).
- Live fetches through `fetch_url` against the four sites (sites sometimes serve a bot check; itechguides returned a Cloudflare challenge to the default curl agent).
- Other languages and right-to-left pages.
- The fixtures are trimmed, and two are cut at 140 KB, so a full-size page may pick differently.
