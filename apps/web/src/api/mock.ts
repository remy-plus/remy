// A believable in-memory server, so screens can be built before `remy serve` is live (and for demos
// with ?mock=1). It keeps the same shapes as the real routes and applies approve, cancel and so on.
import type {
  ApprovalCard,
  HomeData,
  NeedCard,
  RemyApi,
  StreamEvent,
  TaskListItem,
  TaskStatus,
  TaskView,
  WorkItem,
} from './types.ts';

interface Seed {
  id: string;
  prompt: string;
  status: TaskStatus;
  at: string;
  cost: number;
  step?: number;
  card?: ApprovalCard;
  answer?: string;
}

const day = '2026-11-08';
const iso = (hm: string) => `${day}T${hm}:00.000Z`;
const card = (callId: string, preview: string, risk: ApprovalCard['risk'], reason: string) => ({
  callId,
  argsHash: `hash_${callId}`,
  preview,
  risk,
  reason,
});

const SEEDS: Seed[] = [
  {
    id: 'task_flights',
    prompt: "Book Dana's flights",
    status: 'waiting_approval',
    at: '18:30',
    cost: 0.21,
    step: 4,
    card: card(
      'call_flights',
      'Book TAP London to Lisbon, 17 to 20 Nov. GBP 312.00. Aisle seat held until 19:00.',
      'spend_money',
      'This spends money.',
    ),
  },
  {
    id: 'task_reply',
    prompt: 'Reply to Dana about the audit date',
    status: 'waiting_approval',
    at: '18:12',
    cost: 0.04,
    step: 3,
    card: card(
      'call_reply',
      'Send to Dana Ferreira: confirms Tue 17 and asks for the agenda.',
      'send_as_user',
      'This sends as you.',
    ),
  },
  {
    id: 'task_audit',
    prompt: 'Prepare the audit pack for Dana',
    status: 'running',
    at: '18:51',
    cost: 0.38,
    step: 3,
  },
  {
    id: 'task_rename',
    prompt: 'Rename invoices, 2026',
    status: 'running',
    at: '18:30',
    cost: 0.12,
    step: 5,
  },
  {
    id: 'task_notion',
    prompt: 'Weekly report from Notion',
    status: 'running',
    at: '18:20',
    cost: 0.09,
    step: 2,
  },
  {
    id: 'task_fares',
    prompt: 'Watching Lisbon fares',
    status: 'running',
    at: '14:00',
    cost: 0.03,
    step: 1,
  },
  {
    id: 'task_owe',
    prompt: 'What do I still owe Dana?',
    status: 'succeeded',
    at: '09:10',
    cost: 0.06,
    step: 4,
    answer:
      'Three things and one contradiction: the audit pack, a signed form, and the Q3 invoice.',
  },
  {
    id: 'task_printer',
    prompt: 'File the Printer down issue in the IT tracker',
    status: 'cancelled',
    at: '09:13',
    cost: 0.02,
    step: 2,
  },
];

const taskView = (s: Seed): TaskView => ({
  taskId: s.id,
  prompt: s.prompt,
  status: s.status,
  seq: 6,
  step: s.step ?? 1,
  createdAt: iso(s.at),
  costUsd: s.cost,
  tainted: false,
  config: {
    model: 'mock-model',
    trust: 'ask',
    budget: { maxSteps: 40, maxCostUsd: 2, maxWallMs: 3_600_000 },
  },
  ...(s.card && { pendingApproval: s.card }),
  ...(s.answer && { final: { status: 'succeeded' as const, answer: s.answer } }),
  ...(s.status === 'cancelled' && {
    final: { status: 'cancelled' as const, reason: 'Stopped by you.' },
  }),
  calls: [],
  running: s.status === 'running',
});

const eventsOf = (v: TaskView): StreamEvent[] => {
  const ev = (seq: number, event: StreamEvent['event']): StreamEvent => ({
    seq,
    at: v.createdAt,
    event,
  });
  const out = [
    ev(1, { type: 'task.created', prompt: v.prompt }),
    ev(2, { type: 'progress', step: 1, text: 'Read the request and made a plan.' }),
    ev(3, { type: 'progress', step: 2, text: 'Gathered what it needs.' }),
  ];
  if (v.pendingApproval) out.push(ev(4, { type: 'approval.requested', ...v.pendingApproval }));
  if (v.final) out.push(ev(4, { type: 'task.finished', ...v.final }));
  return out;
};

const NEED: Record<string, Omit<NeedCard, 'taskId'>> = {
  task_flights: {
    kind: 'Spends money',
    waiting: 'waiting 12 min',
    title: 'Book TAP London to Lisbon, 17 to 20 Nov',
    detail: '£312.00. Cheapest of 14. Aisle seat held until 19:00.',
    approval: {
      callId: 'call_flights',
      argsHash: 'hash_call_flights',
      approve: 'Approve and book',
      decline: "Don't book",
    },
    others: 2,
  },
  task_reply: {
    kind: 'Sends as you',
    title: 'Reply to Dana about the audit date',
    detail: 'Draft ready: confirms Tue 17 and asks for the agenda.',
    review: 'Review draft',
  },
};

const WORK: WorkItem[] = [
  {
    taskId: 'task_flights',
    title: "Book Dana's flights",
    state: 'waiting on you',
    done: 3,
    total: 5,
    line: 'Step 4 of 5. Compared 14 flights, held the best fare.',
  },
  {
    taskId: 'task_rename',
    title: 'Rename invoices, 2026',
    state: 'on home-server · 21 of 31',
    done: 4,
    total: 5,
    line: 'Moving files by year-month-vendor. No errors.',
  },
  {
    taskId: 'task_notion',
    title: 'Weekly report from Notion',
    state: 'drafting',
    done: 2,
    total: 5,
    line: 'Pulled 6 pages. Writing in your usual format.',
  },
  {
    taskId: 'task_fares',
    title: 'Watching Lisbon fares',
    state: 'checks hourly',
    done: 0,
    total: 0,
    line: 'Down £19 since 14:00. I will tell you under £290.',
  },
];

const headline = (n: number) =>
  n === 0
    ? 'Nothing needs you.'
    : `${['', 'One thing needs', 'Two things need', 'Three things need'][n] ?? `${n} things need`} you.`;

export function createMockApi(): RemyApi {
  const tasks = new Map<string, TaskView>(SEEDS.map((s) => [s.id, taskView(s)]));
  const updated = new Map<string, string>(SEEDS.map((s) => [s.id, iso(s.at)]));
  let counter = 0;
  const get = (id: string) => {
    const v = tasks.get(id);
    if (!v) throw new Error('There is no such task.');
    return v;
  };
  const set = (id: string, patch: Partial<TaskView>) => {
    const next = { ...get(id), ...patch };
    delete next.pendingApproval;
    if (patch.pendingApproval) next.pendingApproval = patch.pendingApproval;
    tasks.set(id, next);
    updated.set(id, `${day}T${new Date().toTimeString().slice(0, 5)}:00.000Z`);
  };

  const api: RemyApi = {
    kind: 'mock',
    async listTasks(q) {
      const items: TaskListItem[] = [...tasks.values()]
        .map((v) => ({
          id: v.taskId,
          prompt: v.prompt,
          status: v.status,
          createdAt: v.createdAt,
          updatedAt: updated.get(v.taskId) ?? v.createdAt,
          costUsd: v.costUsd,
        }))
        .filter((t) => !q?.status || t.status === q.status)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return items.slice(0, q?.limit ?? 50);
    },
    async startTask(prompt) {
      const taskId = `task_mock${++counter}`;
      tasks.set(taskId, taskView({ id: taskId, prompt, status: 'running', at: '18:42', cost: 0 }));
      updated.set(taskId, iso('18:42'));
      return { taskId };
    },
    async getTask(id) {
      return get(id);
    },
    async streamTask(id, onEvent, o) {
      for (const e of eventsOf(get(id))) {
        if (o?.signal?.aborted) return;
        if (e.seq > (o?.lastEventId ?? 0)) onEvent(e);
        await Promise.resolve();
      }
    },
    async approve(id, body) {
      const v = get(id);
      if (v.pendingApproval?.callId !== body.callId) throw new Error('There is no such approval.');
      if (v.pendingApproval.argsHash !== body.argsHash)
        throw new Error('approval is for different arguments');
      set(id, { status: 'running', running: true });
    },
    async answer(id) {
      set(id, { status: 'running', running: true });
    },
    async cancel(id) {
      set(id, {
        status: 'cancelled',
        running: false,
        final: { status: 'cancelled', reason: 'Stopped by you.' },
      });
    },
    async extend(id) {
      set(id, { status: 'running', running: true });
    },
    async home(): Promise<HomeData> {
      const needsYou = [...tasks.values()].flatMap((v) => {
        const n = NEED[v.taskId];
        return n && v.pendingApproval ? [{ taskId: v.taskId, ...n }] : [];
      });
      const alert = { text: 'Slack sign-in ended. 2 summaries paused.', action: 'Sign in' };
      const working = WORK.filter((w) => tasks.get(w.taskId)?.status !== 'cancelled').map((w) =>
        w.state === 'waiting on you' && tasks.get(w.taskId)?.status === 'running'
          ? { ...w, state: 'working' }
          : w,
      );
      return {
        status: {
          running: 4,
          machinesUp: 2,
          notes: 1204,
          trust: 'ask',
          quiet: false,
          time: '18:42',
        },
        briefing: {
          headline: headline(needsYou.length + 1),
          rest: 'Everything else is on track.',
          stats: ['Since 14:00', '11 steps done', '1 flight held', '£0.00 spent'],
          asks: [
            'What do I still owe Dana?',
            'Prepare the audit pack',
            'What changed since Friday?',
          ],
        },
        satellites: [{ label: 'fares' }, { label: 'invoices' }],
        needsYou,
        working,
        noticed: [
          {
            at: '17:55',
            text: 'Dana’s audit moved to Tue 17. I held your calendar and searched flights.',
          },
          { at: '16:30', text: 'Acme’s invoice is 4 days overdue. Reminder drafted, not sent.' },
          {
            at: '15:12',
            text: 'You rename invoices the same way each month. I can do it on the 1st.',
          },
        ],
        alert,
        brain: {
          notes: 1204,
          newToday: 6,
          connected: [
            { name: 'Dana Ferreira', links: 41 },
            { name: 'Audit 2026', links: 27 },
            { name: 'Lisbon trip', links: 19 },
          ],
        },
      };
    },
  };
  return api;
}
