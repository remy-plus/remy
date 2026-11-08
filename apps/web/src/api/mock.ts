// A believable in-memory server, so screens can be built before `remy serve` is live (and for demos
// with ?mock=1). It keeps the same shapes as the real routes and applies approve, cancel and so on.
import type {
  ApprovalCard,
  ApprovalDetail,
  HomeData,
  NeedCard,
  RemyApi,
  ReviewData,
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
  /** Extra fields for the list and the task view. */
  list?: { note?: string; label?: string; when?: string };
  extra?: Partial<TaskView>;
  /** [time with seconds, text] lines for the log. */
  log?: [string, string][];
}

const day = '2026-11-08';
const iso = (hm: string) => `${day}T${hm.length === 5 ? `${hm}:00` : hm}.000Z`;
const card = (
  callId: string,
  preview: string,
  risk: ApprovalCard['risk'],
  reason: string,
  detail?: ApprovalDetail,
): ApprovalCard => ({
  callId,
  argsHash: `hash_${callId}`,
  preview,
  risk,
  reason,
  ...(detail && { detail }),
});

const sendDetail = (to: string, subject: string, body: string[], attachment?: string) => ({
  headers: [
    { k: 'To', v: to },
    { k: 'Subject', v: subject },
  ],
  body,
  ...(attachment && { attachment }),
  effects: [
    { label: 'Send 1 email', value: 'as you' },
    { label: 'To 1 person', value: 'outside' },
    ...(attachment ? [{ label: 'With 1 attachment', value: '18 pages' }] : []),
    { label: 'Cost', value: '£0.00' },
  ],
});

const SEEDS: Seed[] = [
  {
    id: 'task_correction',
    prompt: 'Draft a correction to Dana',
    status: 'waiting_approval',
    at: '18:40',
    cost: 0.07,
    step: 4,
    list: { note: 'Sends as you · audit-pack-2026-Q3.pdf attached', when: '2 min ago' },
    card: card(
      'call_correction',
      'Send to Dana Ferreira: corrects the Q3 vendor total to £1,380,000, audit pack attached.',
      'send_as_user',
      'Sending as you always needs your OK.',
      {
        title: 'Send this correction to Dana?',
        ...sendDetail(
          'Dana Ferreira <dana@finance.example.test>',
          'Correction: Q3 vendor total',
          [
            'Hi Dana,',
            'A correction to my note of 3 November. The Q3 vendor total is £1,380,000, not £1,420,000. The £40,000 difference is Acme’s credit note CN-0412, dated 30 October, which I had not posted.',
            'The full reconciliation is attached. Two items differ, both explained on page 3.',
            'Thanks,\nAarav',
          ],
          'audit-pack-2026-Q3.pdf · 18 pages',
        ),
        highlight: '£1,380,000',
        canEdit: true,
      },
    ),
    log: [
      ['18:34:10', 'read the Q3 reconciliation and your note of 3 November'],
      ['18:38:52', 'drafted the correction to Dana'],
      ['18:40:03', 'asked you before sending'],
    ],
  },
  {
    id: 'task_flights',
    prompt: "Book Dana's flights",
    status: 'waiting_approval',
    at: '18:30',
    cost: 0.21,
    step: 4,
    list: { note: 'Spends £312.00 · seat held until 19:00', when: '12 min ago' },
    card: card(
      'call_flights',
      'Book TAP London to Lisbon, 17 to 20 Nov. GBP 312.00. Aisle seat held until 19:00.',
      'spend_money',
      'This spends money.',
      {
        title: 'Book this flight for Dana?',
        headers: [
          { k: 'Flight', v: 'TAP TP1355 London to Lisbon' },
          { k: 'Dates', v: '17 to 20 Nov, return TP1350' },
        ],
        body: ['Cheapest of 14 fares. Aisle seat 14C is held until 19:00.'],
        highlight: '£312.00',
        effects: [
          { label: 'Book 1 return flight', value: 'Dana Ferreira' },
          { label: 'Charge', value: '£312.00' },
          { label: 'Refund', value: 'free until 17:00 tomorrow' },
        ],
      },
    ),
  },
  {
    id: 'task_acme',
    prompt: 'Reminder to Acme about invoice 0412',
    status: 'waiting_approval',
    at: '04:02',
    cost: 0.01,
    step: 3,
    list: { note: 'Sends as you · drafted overnight', when: '04:02' },
    card: card(
      'call_acme',
      'Send to Marcus at Acme: a gentle reminder that invoice 0412 for £12,400 was due on 4 November.',
      'send_as_user',
      'Sending as you always needs your OK.',
      {
        title: 'Send this reminder to Acme?',
        ...sendDetail('Marcus Hale <marcus@acme.example.test>', 'Invoice 0412', [
          'Hi Marcus,',
          'A gentle reminder that invoice 0412 for £12,400 was due on 4 November. Could you let me know when to expect payment?',
          'Thanks,\nAarav',
        ]),
        canEdit: true,
      },
    ),
  },
  {
    id: 'task_audit',
    prompt: 'Prepare the audit pack for Dana',
    status: 'running',
    at: '18:51',
    cost: 0.38,
    step: 3,
    list: { note: '4 helpers · step 3 of 5 · £0.38 of £2.00' },
    log: [
      ['18:51:20', "Read Dana's request and the audit checklist in Notion"],
      [
        '18:52:05',
        'Split the work into 4 helpers. Read-only access to home-server, as you allowed',
      ],
      ['18:54:31', 'Reconciler ran 6 read-only commands on home-server'],
      ['18:58:12', 'Researcher found the credit-note rule in the Acme contract'],
    ],
    extra: {
      plan: {
        steps: ['Gather', 'Reconcile', 'Write memo', 'Check', 'Send, with your OK'],
        current: 2,
      },
      helpers: [
        {
          name: 'Reconciler',
          status: 'on home-server',
          note: 'Matched 29 of 31 invoices to the bank export',
          live: 'Invoice 0412 (Acme): £40,000.00 credit',
          progress: 0.92,
        },
        {
          name: 'Researcher',
          status: 'reading',
          note: 'Acme contract, clause 7.2: credit notes',
          live: 'Credit applies from the invoice month, not the posting date',
          progress: 0.7,
        },
        {
          name: 'Drafter',
          status: 'writing',
          note: 'Section 1 and 2 done · 410 words',
          live: 'Section 3, variances · 2 flagged items',
          progress: 0.45,
        },
        {
          name: 'Checker',
          status: 'waiting',
          note: 'Will re-add every total on its own and compare with the Reconciler. Starts when the memo is done.',
          progress: 0,
        },
      ],
      found:
        'Two invoices do not match the bank: Acme £40,000.00 (credit note) and Norvik £1,180.00 (paid twice). Both go in the memo. Nothing has been sent or paid.',
      making: {
        title: 'Q3 vendor reconciliation',
        sub: 'Prepared for Dana Ferreira · page 3 of 18',
        paragraphs: [
          'All 31 vendor invoices for the quarter were matched to the bank export. Two differ.',
          'Q3 vendor total: £1,380,000. This corrects the £1,420,000 sent on 3 November.',
        ],
        rows: [
          ['Acme', 'Credit note CN-0412', '£40,000.00'],
          ['Norvik', 'Paid twice, 12 and 14 Oct', '£1,180.00'],
        ],
        files: [
          { name: 'audit-pack-2026-Q3.pdf', meta: '18 pages · draft' },
          { name: 'reconcile.xlsx', meta: '31 rows · 2 flagged' },
          { name: 'memo.md', meta: '1,210 words' },
        ],
        actions: [
          { label: 'Open the draft', kind: 'open' },
          { label: 'Send to Dana (after checks)', kind: 'send', disabled: true },
        ],
      },
    },
  },
  {
    id: 'task_rename',
    prompt: 'Rename invoices, 2026',
    status: 'running',
    at: '18:30',
    cost: 0.12,
    step: 5,
    list: { note: 'On home-server · 21 of 31' },
  },
  {
    id: 'task_notion',
    prompt: 'Weekly report from Notion',
    status: 'running',
    at: '18:20',
    cost: 0.09,
    step: 2,
    list: { note: 'Pulled 6 pages · writing in your usual format' },
  },
  {
    id: 'task_fares',
    prompt: 'Watching Lisbon fares',
    status: 'running',
    at: '14:00',
    cost: 0.03,
    step: 1,
    list: { note: 'Checks hourly · tells you under £290', label: 'watching' },
  },
  {
    id: 'task_printer',
    prompt: 'File the Printer down issue in the IT tracker',
    status: 'failed',
    at: '09:13',
    cost: 0.01,
    step: 3,
    list: { note: 'Connection closed. One send, no retry' },
    log: [
      ['09:12:41', 'asked you, you approved'],
      ['09:12:58', 'sent create_issue to tracker'],
      ['09:13:02', 'connection closed, no reply'],
      ['09:13:02', 'stopped. No retry.'],
    ],
    extra: {
      createdAt: iso('09:12'),
      calls: [
        {
          callId: 'call_p1',
          tool: 'approval',
          step: 1,
          argsHash: 'hash_p1',
          attempts: 1,
          inFlight: false,
          label: 'You approved sending to the tracker',
          at: '09:12',
          result: { ok: true, content: 'approved', truncated: false },
        },
        {
          callId: 'call_p2',
          tool: 'create_issue',
          step: 2,
          argsHash: 'hash_p2',
          attempts: 1,
          inFlight: false,
          risk: 'irreversible',
          label: 'Create the issue in the tracker',
          at: '09:13',
          lastError: 'connection closed',
          result: { ok: false, error: 'connection closed' },
        },
      ],
      final: { status: 'failed', reason: 'The connection closed before the tracker answered.' },
      failure: {
        title: 'The connection closed before the tracker answered',
        body: 'I sent the request once. I cannot tell whether the issue was created, so I did not send it again.',
        notes: [
          'It may exist already. Check the IT project for “Printer down”.',
          'If it is not there, Remy can try again. That is safe once you have looked.',
        ],
        why: {
          lead: 'A repeat could file the issue twice.',
          strong:
            'Remy never repeats something that changes the outside world until it knows the first one failed.',
        },
        actions: [
          { label: 'I checked. Try again', kind: 'retry' },
          { label: 'It is there. Mark done', kind: 'done' },
          { label: 'Open the tracker', kind: 'link', href: '#/connections' },
        ],
      },
    },
  },
  {
    id: 'task_owe',
    prompt: 'What do I still owe Dana?',
    status: 'succeeded',
    at: '09:10',
    cost: 0.06,
    step: 4,
    list: { note: 'Found 3 things and 1 contradiction', label: 'done', when: 'yesterday' },
    answer: 'You owe Dana three things by Tuesday. One thing you told her is wrong.',
    extra: {
      brain: {
        read: 'read 212 notes, 38 emails, 6 Notion pages and 2 files on home-server in 4.1 s',
        headline: 'You owe Dana three things by Tuesday. One thing you told her is wrong.',
        items: [
          {
            title: 'The Q3 vendor reconciliation.',
            text: 'You promised it on 3 Nov. It is half done on home-server (21 of 31 invoices matched).',
            chips: ['email 3 Nov', 'home-server'],
          },
          {
            title: 'An agenda for the Lisbon sessions.',
            text: 'She asked twice. Her last message is unanswered since 17:55.',
            chips: ['email today'],
          },
          {
            title: 'Sign-off on Acme’s credit note.',
            text: 'It is why the totals differ, and she needs your approval to post it.',
            chips: ['Notion: Audit 2026'],
          },
        ],
        contradiction: {
          text: 'On 3 November you wrote to Dana that the Q3 vendor total was £1.42M. Your reconciliation note from 6 November gives £1.38M. The £40,000 gap is Acme’s credit note dated 30 October, which you had not posted when you wrote to her.',
          left: { label: 'What you told Dana · 3 Nov', value: '£1,420,000' },
          right: { label: 'Reconciled · 6 Nov', value: '£1,380,000' },
          draft: 'Draft a correction to Dana',
        },
        footnote: 'Nothing was sent. Sending the correction will ask you first.',
        used: '9 of 258 items',
        sources: [
          { title: 'Email to Dana, “Q3 vendor total is £1.42M”', meta: 'Gmail · 3 Nov, 11:20' },
          {
            title: 'Note: Q3 reconciliation, 21 of 31 matched',
            meta: 'home-server · reconcile.csv · 6 Nov',
          },
          {
            title: 'Acme credit note CN-0412, £40,000.00',
            meta: 'Notion · Audit 2026 · dated 30 Oct',
          },
        ],
      },
    },
  },
  {
    id: 'task_minutes',
    prompt: "Summarise Monday's meeting notes",
    status: 'succeeded',
    at: '08:40',
    cost: 0.05,
    list: { note: 'Saved as a page in Notion', label: 'done', when: 'yesterday' },
    answer: 'Saved as a page in Notion.',
  },
  {
    id: 'task_domain',
    prompt: 'Renew the remy-demo domain',
    status: 'succeeded',
    at: '08:20',
    cost: 0.02,
    list: { note: 'Renewed for 1 year · £11.00', label: 'done', when: 'yesterday' },
    answer: 'Renewed for 1 year.',
  },
  {
    id: 'task_tidy',
    prompt: 'Tidy the Downloads folder',
    status: 'cancelled',
    at: '08:05',
    cost: 0.01,
    list: { note: 'Stopped by you · nothing moved', when: 'yesterday' },
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
  calls: s.card
    ? [
        {
          callId: s.card.callId,
          tool: s.card.risk === 'spend_money' ? 'book_flight' : 'send_email',
          step: s.step ?? 1,
          argsHash: s.card.argsHash,
          risk: s.card.risk,
          attempts: 0,
          inFlight: false,
          label: s.card.detail?.title.replace(/\?$/, '') ?? 'Do this',
          at: s.at,
        },
      ]
    : [],
  running: s.status === 'running',
  ...s.extra,
});

const eventsOf = (v: TaskView, log?: [string, string][]): StreamEvent[] => {
  const ev = (seq: number, event: StreamEvent['event'], at = v.createdAt): StreamEvent => ({
    seq,
    at,
    event,
  });
  const out = [ev(1, { type: 'task.created', prompt: v.prompt })];
  if (log) {
    log.forEach(([t, text], i) => {
      out.push(ev(i + 2, { type: 'progress', step: i + 1, text }, `${day}T${t}.000Z`));
    });
  } else {
    out.push(
      ev(2, { type: 'progress', step: 1, text: 'Read the request and made a plan.' }),
      ev(3, { type: 'progress', step: 2, text: 'Gathered what it needs.' }),
    );
  }
  const n = out.length + 1;
  if (v.pendingApproval) out.push(ev(n, { type: 'approval.requested', ...v.pendingApproval }));
  if (v.final && !log) out.push(ev(n, { type: 'task.finished', ...v.final }));
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
  task_correction: {
    kind: 'Sends as you',
    title: 'Draft a correction to Dana',
    detail: 'Draft ready: corrects the Q3 total and attaches the audit pack.',
    review: 'Review draft',
  },
};

const REVIEW: ReviewData = {
  span: '23:10 to 07:40',
  headline: 'Three tasks ran. One is waiting for you.',
  rest: 'Nothing was sent or paid without your OK.',
  tiles: [
    { value: '3', label: 'tasks finished' },
    { value: '1', label: 'needs your OK' },
    { value: '£0.11', label: 'spent on models' },
    { value: '0', label: 'sent as you' },
  ],
  timeline: [
    {
      at: '23:30',
      title: 'Renamed 31 invoices',
      tag: 'home-server',
      text: 'All 31 moved to year-month-vendor.pdf. No errors. Undo is available for 7 days.',
    },
    {
      at: '02:14',
      title: 'Watched Lisbon fares',
      text: 'Dropped to £293. Not under £290, so Remy kept watching.',
    },
    {
      at: '04:02',
      title: 'Drafted a reminder to Acme',
      tag: 'waiting for you',
      text: 'Invoice is 4 days overdue. Draft is ready. Remy did not send it.',
      waiting: true,
    },
    {
      at: '06:30',
      title: 'Prepared the weekly report',
      text: 'Pulled 6 Notion pages and wrote it in your format. Saved as a draft.',
    },
  ],
  needs: {
    taskId: 'task_acme',
    kind: 'Sends as you',
    title: 'Reminder to Acme about invoice 0412',
    quote: '“Hi Marcus, a gentle reminder that invoice 0412 for £12,400 was due on 4 November…”',
  },
  awayNote: {
    trust: 'away',
    text: 'Remy carried on with up to 3 waiting approvals and stopped there.',
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
  const meta = new Map(SEEDS.map((s) => [s.id, s]));
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
          ...meta.get(v.taskId)?.list,
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
      for (const e of eventsOf(get(id), meta.get(id)?.log)) {
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
      if (!body.granted) {
        set(id, {
          status: 'cancelled',
          running: false,
          final: { status: 'cancelled', reason: 'You declined.' },
        });
        return;
      }
      set(id, {
        status: 'running',
        running: true,
        calls: v.calls.map((c) =>
          c.callId === body.callId
            ? { ...c, result: { ok: true as const, content: 'done', truncated: false } }
            : c,
        ),
      });
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
    async markDone(id) {
      set(id, { status: 'succeeded', running: false, final: { status: 'succeeded' } });
    },
    async review(): Promise<ReviewData> {
      return REVIEW;
    },
    async home(): Promise<HomeData> {
      const needsYou = Object.entries(NEED).flatMap(([taskId, n]) =>
        tasks.get(taskId)?.pendingApproval ? [{ taskId, ...n }] : [],
      );
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
