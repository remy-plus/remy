// The row under the prompt box, as text: what Remy is doing or where it works on the left,
// the figures and the palette key on the right. Pure; the component only styles it.
import { clip, strWidth } from '../markdown.ts';

export interface StatusInput {
  width: number;
  /** Spinner glyph and narration while a task runs; undefined when idle. */
  working?: { spinner: string; narration: string };
  workspace?: string;
  /** Context used, 0 to 100, when the window is known. */
  contextPct?: number;
  /** Spend of this conversation in US dollars; hidden at zero. */
  costUsd?: number;
  /** Something is typed, so "send now" is worth mentioning while a task runs. */
  hasInput?: boolean;
}

export interface Status {
  left: string;
  /** The "esc interrupt" hint (and "ctrl+s send now" when there is input), kept apart so it can be styled. */
  hint: string;
  right: string;
}

const HOME = process.env.HOME;

/** `/Users/me/proj/app` as `~/proj/app`; a long path keeps its head and its tail. */
export function shortenPath(p: string, max = 40, home = HOME): string {
  const q = home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  if (q.length <= max) return q;
  const tail = Math.max(8, max - 12);
  return `${q.slice(0, 10)}…${q.slice(-tail)}`;
}

export const fmtCostShort = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

const SEP = ' · ';
const GAP = 2;

/** Drops parts as the width shrinks: workspace first, then cost, then context, then the key. */
export function statusLine(i: StatusInput): Status {
  const figures = [
    i.contextPct === undefined ? '' : `${Math.round(i.contextPct)}%`,
    i.costUsd && i.costUsd > 0 ? fmtCostShort(i.costUsd) : '',
  ];
  const rights = [
    [...figures, 'ctrl+p commands'],
    [figures[0] ?? '', 'ctrl+p commands'],
    ['ctrl+p commands'],
    [],
  ].map((parts) => parts.filter(Boolean).join(SEP));
  const hints = i.working
    ? [...(i.hasInput ? ['esc interrupt · ctrl+s send now'] : []), 'esc interrupt', '']
    : [''];
  const base = i.working
    ? `${i.working.spinner} ${i.working.narration}`
    : i.workspace
      ? shortenPath(i.workspace)
      : '';
  const need = (left: string, h: string, right: string) =>
    strWidth(left) + (h ? strWidth(SEP) + strWidth(h) : 0) + (right ? GAP + strWidth(right) : 0);
  for (const right of rights) {
    for (const h of hints)
      if (need(base, h, right) <= i.width) return { left: base, hint: h, right };
  }
  // Nothing fits whole: keep the right side and give the left what is left, if that is worth showing.
  for (const right of rights) {
    const room = i.width - strWidth(right) - (right ? GAP : 0);
    if (room >= 12 && base) return { left: clip(base, room), hint: '', right };
  }
  return { left: '', hint: '', right: '' };
}
