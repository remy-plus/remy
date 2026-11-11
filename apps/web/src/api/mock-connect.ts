// Mock data for connections, skills, schedules and the brain. Mock-only: `remy serve` has no routes
// for these yet. The numbers and names come from the approved frames.
import type {
  AppPermission,
  BrainData,
  BrainNote,
  CatalogApp,
  ConnectedApp,
  ConnectionsData,
  Machine,
  NewScheduleInput,
  PermissionLevel,
  RegistryApp,
  RemyApi,
  ScheduleItem,
  SchedulesData,
  SkillItem,
  SkillsData,
  Webhook,
} from './types.ts';

const perm = (id: string, label: string, detail: string, on: boolean): AppPermission => ({
  id,
  label,
  detail,
  on,
});

const APPS: ConnectedApp[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    blurb: 'Read, draft, send with approval',
    status: 'connected',
    permissions: [
      perm('read', 'Read mail', 'Search and open messages', true),
      perm('draft', 'Draft replies', 'Saved as drafts, never sent', true),
      perm('send', 'Send as you', 'Always asks you first', true),
      perm('delete', 'Delete mail', 'Off. Remy cannot delete', false),
    ],
    untrusted:
      'Mail you receive is treated as untrusted. If a message tries to give Remy orders, Remy shows it to you instead of obeying it.',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    blurb: 'Read and hold time, add events with approval',
    status: 'connected',
    permissions: [
      perm('read', 'Read events', 'See what is on your calendar', true),
      perm('hold', 'Hold time', 'Tentative holds you can remove', true),
      perm('add', 'Add events', 'Always asks you first', true),
    ],
    untrusted:
      'Event titles and notes are treated as untrusted text. Remy never follows instructions found in them.',
  },
  {
    id: 'notion',
    name: 'Notion',
    blurb: 'Read and edit pages in 2 workspaces',
    status: 'connected',
    statusNote: 'read only',
    permissions: [
      perm('read', 'Read pages', 'Search and open pages', true),
      perm('edit', 'Edit pages', 'Off. Remy only reads', false),
    ],
    untrusted: 'Page text is treated as untrusted. Remy does not follow instructions found in it.',
  },
  {
    id: 'slack',
    name: 'Slack',
    blurb: 'Your sign-in ended on 4 November',
    status: 'needs_signin',
    permissions: [
      perm('read', 'Read channels', 'Search and open messages', true),
      perm('post', 'Post as you', 'Always asks you first', true),
    ],
    untrusted:
      'Messages are treated as untrusted text. Remy shows you any that try to give it orders.',
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Read issues and pull requests',
    status: 'not_connected',
    permissions: [
      perm('read', 'Read issues', 'Search and open issues and pull requests', true),
      perm('comment', 'Comment', 'Always asks you first', false),
    ],
    untrusted: 'Issue text is treated as untrusted. Remy does not follow instructions found in it.',
  },
];

const MACHINES: Machine[] = [
  {
    name: 'home-server',
    detail: 'ssh remy@10.0.0.5 · Ubuntu · disk 91% full',
    status: 'reachable',
  },
  {
    name: 'work-vps',
    detail: 'ssh remy@vps.example.test · key in keychain',
    status: 'reachable',
  },
];

const levels = (read: string, draft: string, act: string): CatalogApp['levels'] => [
  { id: 'read', label: 'Read only', detail: read },
  { id: 'draft', label: 'Read and draft', detail: draft },
  { id: 'act', label: 'Act with approval', detail: act },
];

const CATALOG: CatalogApp[] = [
  {
    id: 'linear',
    name: 'Linear',
    blurb: 'Issues and projects',
    levels: levels(
      'Look up issues and projects.',
      'Prepare issues and comments. Nothing posts until you approve.',
      'Create and edit issues. Each one asks first.',
    ),
  },
  {
    id: 'drive',
    name: 'Google Drive',
    blurb: 'Files and docs',
    levels: levels(
      'Find and open files.',
      'Prepare new files. Nothing is saved until you approve.',
      'Create and edit files. Each one asks first.',
    ),
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    blurb: 'Files',
    levels: levels(
      'Find and open files.',
      'Prepare new files. Nothing is saved until you approve.',
      'Move and edit files. Each one asks first.',
    ),
  },
  {
    id: 'stripe',
    name: 'Stripe',
    blurb: 'Payments and invoices',
    spendsMoney: true,
    levels: levels(
      'Look up payments and invoices.',
      'Prepare invoices. Nothing is sent until you approve.',
      'Send invoices and refunds. Each one asks first.',
    ),
  },
  {
    id: 'zoom',
    name: 'Zoom',
    blurb: 'Meetings',
    levels: levels(
      'See your meetings.',
      'Prepare meetings. Nothing is booked until you approve.',
      'Book and change meetings. Each one asks first.',
    ),
  },
  {
    id: 'figma',
    name: 'Figma',
    blurb: 'Design files',
    levels: levels(
      'Open design files.',
      'Prepare comments. Nothing posts until you approve.',
      'Comment and edit. Each one asks first.',
    ),
  },
];

const SKILLS: SkillItem[] = [
  {
    name: 'monthly-report',
    blurb: 'Investor update: revenue, headcount, the ask',
    source: 'learned',
    enabled: true,
    used: 7,
    lastRun: '3 Nov',
    origin: 'Learned from your correction on 6 Oct',
    steps: [
      {
        title: 'Read the notes file',
        detail: 'update.txt in the task folder. Ask if it is missing.',
      },
      {
        title: 'Write in this order',
        detail: 'Revenue, then headcount, then the ask. Never reorder.',
      },
      {
        title: 'Say what was assumed',
        detail: 'Currency, period, and any sentence Remy wrote itself.',
      },
      {
        title: 'Save as investor-update-YYYY-MM.md',
        detail: 'Then show it to you. Nothing is sent.',
      },
    ],
    why: 'On 6 October you corrected Remy: “revenue first, then headcount, then the ask.” Remy saved that as a rule and has followed it on the last 7 runs with no corrections.',
  },
  {
    name: 'weekly-report',
    blurb: 'Shipped and blocked, in two lines',
    source: 'yours',
    enabled: true,
    used: 12,
    lastRun: '7 Nov',
    origin: null,
    steps: [
      { title: 'List what shipped', detail: 'From the tasks finished since the last report.' },
      { title: 'List what is blocked', detail: 'One line each, with who it waits on.' },
      { title: 'Keep it to two lines', detail: 'Shipped on one line, blocked on the other.' },
    ],
    why: null,
  },
  {
    name: 'rename-invoices',
    blurb: 'year-month-vendor.pdf',
    source: 'learned',
    enabled: true,
    used: 3,
    lastRun: '1 Nov',
    origin: 'Learned from your correction on 12 Sep',
    steps: [
      { title: 'Read the invoice', detail: 'Find the vendor, the date and the total.' },
      { title: 'Rename the file', detail: 'year-month-vendor.pdf, for example 2026-10-acme.pdf.' },
      { title: 'Never overwrite', detail: 'If the name is taken, ask before doing anything.' },
    ],
    why: 'On 12 September you renamed three invoices by hand the same way. Remy saved it as a rule and has followed it since.',
  },
  {
    name: 'write-and-send',
    blurb: 'Draft, show you, send after your OK',
    source: 'yours',
    enabled: true,
    used: 21,
    lastRun: '6 Nov',
    origin: null,
    steps: [
      { title: 'Write the draft', detail: 'In your voice, with the facts from the task.' },
      { title: 'Show it to you', detail: 'The whole text, to whom, and from which account.' },
      { title: 'Send only after your OK', detail: 'Never before. Never to anyone else.' },
    ],
    why: null,
  },
  {
    name: 'research',
    blurb: 'Search, read sources, cite them',
    source: 'builtin',
    enabled: true,
    used: 44,
    lastRun: '8 Nov',
    origin: null,
    steps: [
      { title: 'Search', detail: 'Use more than one query.' },
      { title: 'Read the sources', detail: 'Open the pages, not only the snippets.' },
      { title: 'Cite them', detail: 'Every claim links to where it came from.' },
    ],
    why: null,
  },
];

const note = (
  id: string,
  title: string,
  kind: BrainNote['kind'],
  x: number,
  y: number,
  links: string[],
  linkCount: number,
  body: string,
  origin: string,
): BrainNote => ({ id, title, kind, x, y, links, linkCount, body, origin });

const NOTES: BrainNote[] = [
  note(
    'dana',
    'Dana Ferreira',
    'person',
    47.7,
    51.4,
    ['acme', 'audit', 'lisbon', 'vendor', 'send-first', 'priya'],
    41,
    'Leads finance. Send audit questions to her first. Prefers email before 10:00.',
    'You told Remy · 3 November, in “Book Dana’s flights”. Edited by you 6 Nov.',
  ),
  note(
    'acme',
    'Acme',
    'project',
    27.7,
    31.5,
    ['dana', 'name-invoices'],
    9,
    'Largest vendor. Invoices arrive on the 1st and are due in 30 days.',
    'Remy noticed this · 12 September, from your invoice folder.',
  ),
  note(
    'aisle',
    'Aisle seats',
    'fact',
    42.2,
    22.9,
    ['lisbon'],
    3,
    'You always pick an aisle seat on flights.',
    'You told Remy · 20 October, in “Book Dana’s flights”.',
  ),
  note(
    'audit',
    'Audit 2026',
    'project',
    71.1,
    37.2,
    ['dana', 'lisbon', 'q3-total', 'vendor', 'revenue-first'],
    27,
    'The yearly audit, led by Dana. It moved to Tuesday 17 November.',
    'You told Remy · 8 November, from Dana’s email.',
  ),
  note(
    'lisbon',
    'Lisbon trip',
    'project',
    71.1,
    67,
    ['dana', 'audit', 'aisle'],
    19,
    'Trip for the audit, 17 to 20 November. Flights held, hotel not booked.',
    'You told Remy · 8 November.',
  ),
  note(
    'name-invoices',
    'Name invoices year-month-vendor',
    'how-to',
    16.6,
    51.5,
    ['acme'],
    5,
    'Rename each invoice to year-month-vendor.pdf. Ask before overwriting.',
    'Learned from your correction · 12 September.',
  ),
  note(
    'revenue-first',
    'Revenue first, then headcount',
    'how-to',
    78,
    55,
    ['audit'],
    7,
    'In every investor update, write revenue first, then headcount, then the ask.',
    'Learned from your correction · 6 October.',
  ),
  note(
    'priya',
    'Priya Nair',
    'person',
    25.5,
    67,
    ['dana', 'working-hours'],
    14,
    'Runs operations. Works with Dana on the audit pack.',
    'You told Remy · 2 October.',
  ),
  note(
    'q3-total',
    'Q3 total £1.38M',
    'fact',
    57.7,
    76.9,
    ['audit', 'vendor'],
    6,
    'Total spend for the third quarter, from the bank export.',
    'Remy read it · 30 October, from the bank export.',
  ),
  note(
    'working-hours',
    'Working hours 09:00 to 17:30',
    'fact',
    33.3,
    81.2,
    ['priya'],
    4,
    'Your working hours. Remy does not book meetings outside them.',
    'You told Remy · 24 September.',
  ),
  note(
    'vendor',
    'Q3 vendor reconciliation',
    'fact',
    58,
    24,
    ['dana', 'audit', 'q3-total'],
    12,
    'Vendor payments for Q3 matched to the bank export. Two items are open.',
    'Remy wrote it · 1 November.',
  ),
  note(
    'send-first',
    'Send audit questions to Dana first',
    'how-to',
    40,
    61,
    ['dana'],
    3,
    'Before asking anyone else about the audit, send the questions to Dana.',
    'Learned from your correction · 14 October.',
  ),
];

const SCHEDULES: ScheduleItem[] = [
  {
    id: 'weekly-report',
    title: 'Weekly report from Notion',
    detail: 'Drafts it, shows you, does not send',
    when: 'Fridays at 16:00',
    next: 'next in 4 days · last ok',
    enabled: true,
  },
  {
    id: 'rename-invoices',
    title: 'Rename invoices',
    detail: 'On home-server, by year-month-vendor',
    when: '1st of month, 09:00',
    next: 'next in 23 days · last ok',
    enabled: true,
  },
  {
    id: 'lisbon-fares',
    title: 'Watch Lisbon fares',
    detail: 'Tells you under £290',
    when: 'Every hour',
    next: 'next in 18 min · £293',
    enabled: true,
  },
  {
    id: 'slack-summary',
    title: 'Slack summary',
    detail: 'Paused: Slack needs a sign-in',
    when: 'Weekdays at 08:30',
    next: 'paused since 4 Nov',
    enabled: false,
    fix: { label: 'Fix it', href: '#/connections' },
  },
];

const WEBHOOKS: Webhook[] = [
  {
    id: 'new-invoice',
    name: 'new-invoice',
    url: 'POST http://127.0.0.1:7788/hook/new-invoice',
    detail:
      'Runs “check it against the bank export”. Payloads are treated as untrusted, and the run starts at trust level ask. Last call 2 days ago.',
    enabled: true,
  },
];

const TIMELINE: SchedulesData['timeline'] = [
  { at: 'in 18 min', title: 'Check Lisbon fares', soon: true },
  { at: 'tomorrow 08:30', title: 'Slack summary', note: 'paused' },
  { at: 'tomorrow 16:00', title: 'Weekly report from Notion' },
];

/** A few real registry records, so the search box has something to show without a network. */
const REGISTRY: RegistryApp[] = [
  {
    name: 'app.linear/linear',
    title: 'Linear',
    description: 'Issues, projects and cycles.',
    version: '1.0.0',
    kind: 'remote',
    where: 'https://mcp.linear.app/mcp',
    command: 'remy connect --registry app.linear/linear',
  },
  {
    name: 'com.notion/mcp',
    title: 'Notion',
    description: 'Pages, databases and search.',
    version: '2.1.0',
    kind: 'remote',
    where: 'https://mcp.notion.com/mcp',
    command: 'remy connect --registry com.notion/mcp',
  },
  {
    name: 'io.github.me/mcp-filesystem',
    title: 'Filesystem',
    description: 'Read and write files in one folder.',
    version: '0.2.0',
    kind: 'package',
    where: 'npx -y @me/mcp-filesystem',
    command: 'remy connect --registry io.github.me/mcp-filesystem',
  },
  {
    name: 'ai.smithery/smithery-ai-slack',
    title: 'Slack',
    description: 'Channels, messages and search.',
    version: '1.4.2',
    kind: 'remote',
    where: 'https://server.smithery.ai/@smithery-ai/slack/mcp',
    command: 'remy connect --registry ai.smithery/smithery-ai-slack',
  },
];

const REGISTRY_NOTE =
  'These come from the official registry, not from Remy. Adding one runs a command or connects an address, so it is done in your terminal, where you see the exact command first.';

const clone = <T>(x: T): T => structuredClone(x);
const wait = <T>(v: T): Promise<T> => Promise.resolve(v);

/** The new methods of RemyApi, with their own state. Mock-only. */
export function createConnectMock(): Pick<
  RemyApi,
  | 'connections'
  | 'setPermission'
  | 'disconnectApp'
  | 'signInApp'
  | 'appCatalog'
  | 'searchApps'
  | 'connectApp'
  | 'testMachine'
  | 'addMachine'
  | 'skills'
  | 'setSkillEnabled'
  | 'runSkill'
  | 'resolveSuggestion'
  | 'schedules'
  | 'setScheduleEnabled'
  | 'runScheduleNow'
  | 'setWebhookEnabled'
  | 'createSchedule'
  | 'brain'
  | 'updateNote'
  | 'deleteNote'
> {
  const apps = clone(APPS);
  const machines = clone(MACHINES);
  const skills = clone(SKILLS);
  let suggestion: SkillsData['suggestion'] = {
    text: 'You renamed receipts the same way three times. Save it as a skill?',
  };
  const schedules = clone(SCHEDULES);
  const webhooks = clone(WEBHOOKS);
  const notes = clone(NOTES);
  let runs = 0;
  const app = (id: string) => {
    const a = apps.find((x) => x.id === id);
    if (!a) throw new Error('There is no such app.');
    return a;
  };
  const levelOn: Record<PermissionLevel, number> = { read: 1, draft: 2, act: 3 };

  return {
    connections: (): Promise<ConnectionsData> =>
      wait({ apps: clone(apps), machines: clone(machines) }),
    async setPermission(appId, permissionId, on) {
      const p = app(appId).permissions.find((x) => x.id === permissionId);
      if (!p) throw new Error('There is no such permission.');
      p.on = on;
    },
    async disconnectApp(appId) {
      const a = app(appId);
      a.status = 'not_connected';
      delete a.statusNote;
    },
    async signInApp(appId) {
      const a = app(appId);
      a.status = 'connected';
      a.blurb = a.id === 'slack' ? 'Read channels, post with approval' : a.blurb;
    },
    appCatalog: () => wait(clone(CATALOG)),
    searchApps: (query) => {
      const q = query.trim().toLowerCase();
      const apps = REGISTRY.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q),
      );
      return wait({ apps: clone(apps), note: REGISTRY_NOTE });
    },
    async connectApp(appId, level) {
      const c = CATALOG.find((x) => x.id === appId);
      if (!c) throw new Error('There is no such app.');
      const n = levelOn[level];
      apps.push({
        id: c.id,
        name: c.name,
        blurb: c.blurb,
        status: 'connected',
        ...(level === 'read' ? { statusNote: 'read only' } : {}),
        permissions: c.levels.map((l) => perm(l.id, l.label, l.detail, levelOn[l.id] <= n)),
        untrusted: `Text from ${c.name} is treated as untrusted. Remy does not follow instructions found in it.`,
      });
    },
    async testMachine(input) {
      return {
        ok: true,
        lines: [
          `Connected to ${input.name}`,
          'Ubuntu 24.04 · 8 GB memory',
          'Disk 91% full · 1 warning',
          'Host key checked and saved.',
        ],
      };
    },
    async addMachine(input) {
      machines.push({
        name: input.name,
        detail: `ssh ${input.user}@${input.host}${input.port === 22 ? '' : `:${input.port}`}`,
        status: 'reachable',
      });
    },
    skills: (): Promise<SkillsData> => wait({ skills: clone(skills), suggestion }),
    async setSkillEnabled(name, enabled) {
      const s = skills.find((x) => x.name === name);
      if (s) s.enabled = enabled;
    },
    async runSkill() {
      runs += 1;
      return { taskId: `task_mock_skill${runs}` };
    },
    async resolveSuggestion(accept) {
      if (accept) {
        skills.push({
          name: 'rename-receipts',
          blurb: 'Rename receipts the way you did',
          source: 'learned',
          enabled: true,
          used: 0,
          lastRun: null,
          origin: 'Learned from three renames you did by hand',
          steps: [
            { title: 'Read the receipt', detail: 'Find the shop, the date and the total.' },
            { title: 'Rename the file', detail: 'year-month-shop.pdf. Ask before overwriting.' },
          ],
          why: 'You renamed receipts the same way three times, so Remy saved the pattern.',
        });
      }
      suggestion = null;
    },
    schedules: (): Promise<SchedulesData> =>
      wait({
        schedules: clone(schedules),
        timeline: clone(TIMELINE),
        webhooks: clone(webhooks),
        webhooksNote: 'listening on this machine only',
        away: 'Last night Remy ran 3 tasks, asked for 1 approval and spent £0.11.',
        runsOn: ['this machine', ...machines.map((m) => m.name)],
        policy: { trust: 'steady', stopAbove: '£0.50' },
      }),
    async setScheduleEnabled(id, enabled) {
      const s = schedules.find((x) => x.id === id);
      if (s) s.enabled = enabled;
    },
    async runScheduleNow() {
      runs += 1;
      return { taskId: `task_mock_run${runs}` };
    },
    async setWebhookEnabled(id, enabled) {
      const w = webhooks.find((x) => x.id === id);
      if (w) w.enabled = enabled;
    },
    async createSchedule(input: NewScheduleInput) {
      const id = `schedule_${schedules.length + 1}`;
      schedules.push({
        id,
        title: input.prompt.length > 40 ? `${input.prompt.slice(0, 37)}...` : input.prompt,
        detail: `Runs on ${input.runsOn}`,
        when: input.when,
        next: 'next run soon',
        enabled: true,
      });
      return { id };
    },
    brain: (): Promise<BrainData> =>
      wait({
        total: 1204,
        newToday: 6,
        counts: { person: 38, project: 21, 'how-to': 17, fact: 1128 },
        notes: clone(notes),
        selected: 'dana',
      }),
    async updateNote(id, body) {
      const n = notes.find((x) => x.id === id);
      if (n) n.body = body;
    },
    async deleteNote(id) {
      const i = notes.findIndex((x) => x.id === id);
      if (i >= 0) notes.splice(i, 1);
    },
  };
}
