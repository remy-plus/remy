// GET /api/review?since=24h: the overnight review as the web screen wants it, from the same data
// as `remy review` (collectReview): tasks that ran without the user at the keyboard. Prompts and
// card text are untrusted words, already cut short and cleaned by collectReview; the screen shows
// them as text.
import { type EventStore, fold, MAX_WAITING_CARDS } from '@remy/core';
import { collectReview, parseSince, type ReviewItem } from './review.ts';
import type { Schedule } from './schedule.ts';
import type { ApiRoute } from './serve.ts';
import { HttpError } from './serve.ts';
import type { WebPrefsStore } from './serve-settings.ts';

export interface ReviewRouteDeps {
  store: EventStore;
  home: string;
  prefs: WebPrefsStore;
  schedules: () => Schedule[];
  now?: () => Date;
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const KIND: Record<string, string> = {
  write: 'Writes',
  send_as_user: 'Sends as you',
  spend_money: 'Spends money',
  irreversible: 'Cannot be undone',
  read: 'Reads',
};

function describe(i: ReviewItem): { text: string; tag?: string; waiting?: boolean } {
  const parts: string[] = [];
  if (i.did.length)
    parts.push(
      `${i.did.slice(0, 3).join('; ')}${i.did.length > 3 ? `; and ${i.did.length - 3} more` : ''}.`,
    );
  if (i.reason) parts.push(`${i.reason}.`);
  if (i.waiting.length) parts.push('Waiting for your OK. That step has not run.');
  if (!parts.length)
    parts.push(
      i.status === 'succeeded'
        ? 'Finished with nothing changed.'
        : `Status: ${i.status.replaceAll('_', ' ')}.`,
    );
  const waiting = i.waiting.length > 0 || i.status === 'waiting_approval';
  return {
    text: parts.join(' '),
    tag: waiting ? 'waiting for you' : i.source,
    ...(waiting && { waiting: true }),
  };
}

export async function buildReview(d: ReviewRouteDeps, sinceText: string | null) {
  const now = (d.now ?? (() => new Date()))();
  const since = parseSince(sinceText ?? '24h', now);
  if (!since) throw new HttpError(400, 'Use since=24h, 7d or a date such as 2026-11-01.');
  const items = await collectReview({
    store: d.store,
    home: d.home,
    since,
    schedules: d.schedules(),
  });
  const chronological = [...items].sort((a, b) => a.at.localeCompare(b.at));
  const needing = items.filter((i) => i.attention);
  const finished = items.filter((i) => i.status === 'succeeded').length;
  const waiting = items.filter((i) => i.waiting.length > 0).length;
  const sent = items.reduce((n, i) => n + i.did.filter((x) => x.startsWith('sent with')).length, 0);
  const spent = items.reduce((n, i) => n + i.costUsd, 0);

  // The first task with a card waiting becomes the big card on the right.
  let needs: { taskId: string; kind: string; title: string; quote: string } | null = null;
  const first = items.find((i) => i.waiting.length > 0);
  if (first) {
    const risk = fold(await d.store.read(first.taskId)).pendingApproval?.risk;
    needs = {
      taskId: first.taskId,
      kind: (risk && KIND[risk]) || 'Needs your OK',
      title: first.prompt,
      quote: first.waiting[0] as string,
    };
  }
  const trust = d.prefs.get().trust;
  return {
    span: `${since.toDateString() === now.toDateString() ? '' : `${DAYS[since.getDay()]} `}${hhmm(since)} to ${hhmm(now)}`,
    headline: items.length
      ? `${plural(items.length, 'task')} ran.${needing.length ? ` ${needing.length === 1 ? 'One needs' : `${needing.length} need`} you.` : ''}`
      : 'Nothing ran without you.',
    rest: sent === 0 ? 'Nothing was sent as you.' : `${plural(sent, 'message')} sent as you.`,
    tiles: [
      { value: String(finished), label: 'tasks finished' },
      { value: String(waiting), label: 'needs your OK' },
      { value: usd(spent), label: 'spent on models' },
      { value: String(sent), label: 'sent as you' },
    ],
    timeline: chronological.map((i) => ({
      at: hhmm(new Date(i.at)),
      title: i.prompt,
      ...describe(i),
    })),
    needs,
    awayNote:
      trust === 'away'
        ? {
            trust,
            text: `Remy carried on with up to ${MAX_WAITING_CARDS} waiting approvals and stopped there.`,
          }
        : null,
  };
}

/** GET /api/review. */
export function reviewRoutes(d: ReviewRouteDeps): ApiRoute {
  return async (ctx) => {
    if (ctx.parts[0] !== 'review' || ctx.parts.length !== 1) return undefined;
    if (ctx.method !== 'GET') return { status: 405, headers: { allow: 'GET' } };
    return { status: 200, body: await buildReview(d, ctx.url.searchParams.get('since')) };
  };
}
