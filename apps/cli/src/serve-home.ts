// GET /api/home: what the web Home shows, made from the task events and the saved settings.
// Nothing is invented. Where Remy has no source (suggested questions, overdue things it cannot
// know about, a connection alert) the list is empty or null and the screen shows its empty state.
// Task text is untrusted, so it is cut short and stripped of control characters, and the web app
// shows it as text.
import {
  type EventStore,
  fold,
  isHelperTask,
  latestPlan,
  type TaskState,
  type TaskSummary,
  waitingCards,
} from '@remy/core';
import { formatMoney } from './currency.ts';
import { cleanText } from './review.ts';
import type { ApiRoute } from './serve.ts';
import type { Spend, WebPrefsStore } from './serve-settings.ts';
import type { Redact } from './serve-view.ts';

export interface HomeDeps {
  store: EventStore;
  prefs: WebPrefsStore;
  spend: Spend;
  redact?: Redact;
  /** Computers set up in remy.config.json. */
  machines: () => number;
  /** How many notes there are; null when they cannot be read. */
  notesCount: () => number | null;
  /** Notes saved since local midnight, or null when unknown. */
  notesToday?: () => number | null;
  now?: () => Date;
}

const NOTICED_HOURS = 4;
const NOTICED_MAX = 5;
const CARDS_MAX = 6;
const WORKING_MAX = 12;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = formatMoney;
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function createHome(d: HomeDeps) {
  const redact: Redact = d.redact ?? ((t) => t);
  const clean = (text: string, max: number) => cleanText(redact(text), max);
  const now = d.now ?? (() => new Date());

  return async () => {
    const t = now();
    const all = (await d.store.listTasks()).filter((s) => !isHelperTask(s.taskId));
    const open = all.filter((s) =>
      ['running', 'waiting_approval', 'waiting_user'].includes(s.status),
    );
    const states = new Map<string, TaskState>();
    for (const s of open) states.set(s.taskId, fold(await d.store.read(s.taskId)));

    const needsYou: unknown[] = [];
    for (const s of open) {
      if (needsYou.length >= CARDS_MAX) break;
      const st = states.get(s.taskId) as TaskState;
      if (st.status === 'waiting_approval' && st.pendingApproval) {
        const a = st.pendingApproval;
        const others = waitingCards(st).filter((c) => c.callId !== a.callId).length;
        needsYou.push({
          taskId: s.taskId,
          kind: a.risk.replaceAll('_', ' '),
          title: clean(st.prompt, 120),
          detail: clean(a.preview, 300),
          approval: {
            callId: a.callId,
            argsHash: a.argsHash,
            approve: 'Approve',
            decline: 'Decline',
          },
          ...(others > 0 && { others }),
        });
      } else if (st.status === 'waiting_user' && st.pendingQuestion) {
        needsYou.push({
          taskId: s.taskId,
          kind: 'question',
          title: clean(st.prompt, 120),
          detail: clean(st.pendingQuestion.question, 300),
        });
      }
    }

    const working = open
      .filter((s) => s.status === 'running')
      .slice(0, WORKING_MAX)
      .map((s) => {
        const st = states.get(s.taskId) as TaskState;
        const plan = latestPlan(st);
        const done = plan.filter((p) => p.status === 'done' || p.status === 'skipped').length;
        const doing =
          plan.find((p) => p.status === 'doing') ?? plan.find((p) => p.status === 'pending');
        return {
          taskId: s.taskId,
          title: clean(st.prompt, 120),
          state: 'working',
          done,
          total: plan.length,
          line: doing
            ? clean(doing.text, 140)
            : `${usd(st.costUsd, d.prefs.get().currency)} so far`,
        };
      });

    // Tasks that ended in the last hours are the one real signal there is for "noticed".
    const since = t.getTime() - NOTICED_HOURS * 3_600_000;
    const ended = all
      .filter(
        (s) =>
          (s.status === 'succeeded' || s.status === 'failed') &&
          new Date(s.updatedAt).getTime() >= since,
      )
      .sort((a: TaskSummary, b: TaskSummary) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, NOTICED_MAX);
    const noticed = [];
    for (const s of ended) {
      const st = fold(await d.store.read(s.taskId));
      const what = clean(st.prompt, 100);
      noticed.push({
        at: hhmm(new Date(s.updatedAt)),
        text:
          s.status === 'failed'
            ? `Could not finish: ${what}${st.final?.reason ? `. ${clean(st.final.reason, 120)}` : ''}`
            : `Finished: ${what}`,
      });
    }

    const prefs = d.prefs.get();
    const notes = d.notesCount();
    const newToday = d.notesToday?.() ?? 0;
    const asks = needsYou.length;
    const running = open.filter((s) => s.status === 'running').length;
    const spent = await d.spend();
    return {
      status: {
        running,
        machinesUp: d.machines(),
        notes,
        trust: prefs.trust,
        quiet: prefs.quiet,
        time: hhmm(t),
      },
      briefing: {
        headline: asks
          ? `${plural(asks, 'thing')} need${asks === 1 ? 's' : ''} you.`
          : 'Nothing needs you.',
        rest: running ? `${plural(running, 'task')} running.` : 'Nothing is running.',
        stats: [
          `${plural(running, 'task')} running`,
          `${plural(ended.length, 'task')} ended in the last ${NOTICED_HOURS} hours`,
          `${usd(spent, prefs.currency)} spent this month`,
        ],
        asks: [] as string[],
      },
      satellites: [] as { label: string }[],
      needsYou,
      working,
      noticed,
      alert: null,
      brain: notes ? { notes, newToday, connected: [] as { name: string; links: number }[] } : null,
    };
  };
}

/** GET /api/home. */
export function homeRoutes(d: HomeDeps): ApiRoute {
  const home = createHome(d);
  return async (ctx) => {
    if (ctx.parts[0] !== 'home' || ctx.parts.length !== 1) return undefined;
    if (ctx.method !== 'GET') return { status: 405, headers: { allow: 'GET' } };
    return { status: 200, body: await home() };
  };
}
