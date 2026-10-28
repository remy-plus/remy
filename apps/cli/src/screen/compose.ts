// All the rows of the session: finished items (memoised) followed by the live turn. Streaming
// text splits at its last blank line, so only the unfinished paragraph is wrapped again on
// each delta.
import type { Item } from '../chat.ts';
import type { Theme } from '../theme.ts';
import type { PlanStep, ToolLine } from '../transcript.ts';
import { BLANK, itemRows, markdownRows, type Row, TEXT_INDENT, toolRows } from './rows.ts';

/** The active turn, as the controller reports it. */
export interface LiveInput {
  streaming: string;
  tools: ToolLine[];
  plan?: PlanStep[];
  queue: string[];
  retrying?: string;
  /** One line about what the model is thinking, when it shows one. */
  thinking?: string;
  /** The current spinner glyph for running tools. */
  spinner: string;
  now: number;
}

export const NO_LIVE: LiveInput = { streaming: '', tools: [], queue: [], spinner: '·', now: 0 };

interface Cached {
  width: number;
  theme: Theme;
  rows: Row[];
}

export interface RowCache {
  items: WeakMap<Item, Cached>;
  head: { width: number; text: string; rows: Row[] };
}

export const createRowCache = (): RowCache => ({
  items: new WeakMap(),
  head: { width: 0, text: '', rows: [] },
});

function cachedItem(cache: RowCache, item: Item, width: number, theme: Theme): Row[] {
  const hit = cache.items.get(item);
  if (hit && hit.width === width && hit.theme === theme) return hit.rows;
  const rows = itemRows(item, width, theme);
  cache.items.set(item, { width, theme, rows });
  return rows;
}

/** Streaming markdown: the settled paragraphs come from the cache, the last one is wrapped now. */
function streamRows(cache: RowCache, text: string, width: number): Row[] {
  const cut = text.lastIndexOf('\n\n');
  const head = cut > 0 ? text.slice(0, cut) : '';
  // An open code fence in the head would render differently once closed: wrap it all.
  const settled = head && (head.match(/```/g)?.length ?? 0) % 2 === 0 ? head : '';
  if (!settled) return markdownRows(text, width);
  if (cache.head.width !== width || cache.head.text !== settled)
    cache.head = { width, text: settled, rows: markdownRows(settled, width) };
  return [...cache.head.rows, BLANK, ...markdownRows(text.slice(cut + 2), width)];
}

interface Block {
  rows: Row[];
  /** A one-row tool call: runs of these sit together with no blank row between. */
  inline: boolean;
}

/** Every row of the conversation at `width`. */
export function buildRows(
  cache: RowCache,
  items: Item[],
  live: LiveInput,
  width: number,
  theme: Theme,
): Row[] {
  const blocks: Block[] = items.map((item) => {
    const rows = cachedItem(cache, item, width, theme);
    return { rows, inline: item.kind === 'tool' && rows.length === 1 };
  });
  if (live.streaming.trim())
    blocks.push({ rows: streamRows(cache, live.streaming, width), inline: false });
  if (live.plan?.length)
    blocks.push({
      rows: itemRows({ kind: 'plan', steps: live.plan }, width, theme),
      inline: false,
    });
  for (const l of live.tools) {
    const rows = toolRows(l, width, theme, live.spinner, live.now);
    blocks.push({ rows, inline: rows.length === 1 });
  }
  if (live.thinking)
    blocks.push({
      rows: [
        {
          spans: [{ text: `${live.spinner} ${live.thinking}`, role: 'muted' }],
          inset: TEXT_INDENT,
          pad: 0,
        },
      ],
      inline: false,
    });
  if (live.retrying)
    blocks.push({
      rows: [{ spans: [{ text: live.retrying, role: 'muted' }], inset: TEXT_INDENT, pad: 0 }],
      inline: false,
    });
  for (const q of live.queue)
    blocks.push({
      rows: [
        {
          spans: [{ text: `${theme.symbols.prompt} ${q}  queued`, role: 'muted' }],
          inset: TEXT_INDENT,
          pad: 0,
        },
      ],
      inline: false,
    });

  const out: Row[] = [];
  blocks.forEach((b, i) => {
    if (i > 0 && !(b.inline && (blocks[i - 1] as Block).inline)) out.push(BLANK);
    out.push(...b.rows);
  });
  return out;
}
