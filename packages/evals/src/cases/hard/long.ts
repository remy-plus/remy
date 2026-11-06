// The long end of the hard suite: more data than fits in a glance, exact results, and work that
// crosses tools. Fixtures are generated from fixed rules, so the right answer is computed here too.
import {
  answerContains,
  answerLacks,
  fileContains,
  fileLines,
  fileMatches,
  status,
} from '../../graders.ts';
import type { EvalCase, McpServerSpec, MockEmail } from '../../types.ts';
import { finish, page, readFile, writeFile } from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const budget = { maxSteps: 60 };
const ok = status('succeeded');
const _read = (id?: string) => ({ tool: 'email_read', args: id ? { id } : {} });
const _mcp = (tool: string, args: Record<string, unknown> = {}) => ({ tool, args });
const range = (n: number) => [...Array(n).keys()];
const pad = (n: number) => String(n).padStart(2, '0');

// ---------- Fixtures ----------
const CATS = ['rent', 'travel', 'food', 'tools'];
const LEDGER = range(100).map((i) => ({
  id: i + 1,
  cat: CATS[i % 4] as string,
  amount: 10 + ((i * 37) % 91),
}));
const totalFor = (cat: string) =>
  LEDGER.filter((r) => r.cat === cat).reduce((a, r) => a + r.amount, 0);
const LEDGER_CSV = `id,category,amount\n${LEDGER.map((r) => `${r.id},${r.cat},${r.amount}`).join('\n')}\n`;

const REFUNDS = range(40).map((i) => ({
  // Every tenth row repeats the id before it: the same charge exported twice.
  id: i % 10 === 9 ? 1000 + i - 1 : 1000 + i,
  amount: i % 7 === 3 ? -(20 + i) : 50 + i,
}));
const REFUND_TOTAL = [...new Map(REFUNDS.map((r) => [r.id, r.amount])).values()].reduce(
  (a, b) => a + b,
  0,
);

const STOCK = range(60).map((i) => ({
  sku: `SKU-${100 + i}`,
  have: (i * 13) % 50,
  min: 10 + (i % 5) * 5,
}));
const LOW = STOCK.filter((s) => s.have < s.min);

const LOG = range(300).map((i) => {
  const t = `12:${pad(Math.floor(i / 60))}:${pad(i % 60)}`;
  if (i === 40) return `${t} ERROR req=a1 timeout before the deploy`;
  if (i === 150) return `${t} INFO deploy finished v2.4`;
  if (i === 212) return `${t} ERROR req=z9 payment webhook 500`;
  if (i === 260) return `${t} ERROR req=q3 payment webhook 500`;
  return `${t} INFO req=r${i} ok`;
});

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const sales = (i: number) => 400 + ((i * 53) % 170);
const _SALES_TOTAL = range(12).reduce((a, i) => a + sales(i), 0);
const _BEST = MONTHS[range(12).reduce((b, i) => (sales(i) > sales(b) ? i : b), 0)] as string;

const RSVP: MockEmail[] = range(20).map((i) => ({
  id: `r${i}`,
  from: `guest${i}@party.test`,
  subject: 'Dinner',
  body: i % 3 === 0 ? 'Sorry, I cannot come.' : 'I will be there.',
}));
RSVP.push({
  id: 'r20',
  from: 'guest1@party.test',
  subject: 'Re: Dinner',
  body: 'Change of plan, I can no longer come.',
});
RSVP.push({
  id: 'r21',
  from: 'guest3@party.test',
  subject: 'Re: Dinner',
  body: 'Good news, I can make it after all.',
});
// 13 said yes of 20; guest1 drops out and guest3 joins.
const _COMING = 13;

const _NOISE: MockEmail[] = range(26).map((i) => ({
  id: `n${i}`,
  from: `updates${i}@lists.test`,
  subject: `Weekly digest ${i}`,
  body: `Nothing to do here. Issue ${i}.`,
}));

const _web = (entries: Record<string, [string, ...string[]]>) =>
  Object.fromEntries(Object.entries(entries).map(([u, [t, ...p]]) => [u, page(t, ...p)]));

const CITIES = [
  'Arlo',
  'Brenn',
  'Cova',
  'Dune',
  'Esk',
  'Fenn',
  'Garth',
  'Holm',
  'Ivar',
  'Jura',
  'Kell',
  'Lorn',
];
const rain = (i: number) => 300 + ((i * 71) % 500);
const _WETTEST = CITIES[range(12).reduce((b, i) => (rain(i) > rain(b) ? i : b), 0)] as string;

const _tracker = (issues: string): McpServerSpec => ({
  name: 'tracker',
  trustHints: true,
  tools: [
    {
      name: 'list_issues',
      description: 'List the open issues in a project.',
      params: { project: 'The project' },
      annotations: { readOnlyHint: true },
      result: { output: issues },
    },
    {
      name: 'create_issue',
      description: 'Create an issue in a project.',
      params: { project: 'The project', title: 'The title', body: 'The body' },
      result: { output: 'Created issue #88.' },
    },
  ],
});

const _calendar: McpServerSpec = {
  name: 'calendar',
  trustHints: true,
  tools: [
    {
      name: 'busy_times',
      description: 'List the hours a person is busy on a day.',
      params: { person: 'The person', day: 'The day' },
      annotations: { readOnlyHint: true },
      result: {
        output:
          'Ana is busy 9-12 and 14-15. Ben is busy 10-11, 13-14 and 16-17. Cy is busy 9-10 and 13-16.',
      },
    },
  ],
};

export const long: EvalCase[] = [
  {
    id: 'hard-long-ledger-by-category',
    suite: 'hard',
    prompt:
      'ledger.csv has 100 rows. Write totals.md with one line per category and its exact total.',
    world: { files: { 'ledger.csv': LEDGER_CSV } },
    human,
    budget,
    graders: [
      ok,
      fileLines('totals.md', 4),
      ...CATS.map((c) => fileMatches('totals.md', new RegExp(`${c}\\D*${totalFor(c)}\\b`, 'i'))),
    ],
    reference: [
      [readFile('ledger.csv')],
      [writeFile('totals.md', CATS.map((c) => `${c}: ${totalFor(c)}`).join('\n'))],
      finish('totals.md has the four category totals.'),
    ],
  },
  {
    id: 'hard-long-charges-exported-twice',
    suite: 'hard',
    prompt:
      'charges.csv is an export with refunds as negative amounts. Some charges were exported twice with the same id. What is the true net total?',
    world: {
      files: {
        'charges.csv': `id,amount\n${REFUNDS.map((r) => `${r.id},${r.amount}`).join('\n')}\n`,
      },
    },
    human,
    budget,
    graders: [ok, answerContains(String(REFUND_TOTAL))],
    reference: [
      [readFile('charges.csv')],
      finish(`The true net total is ${REFUND_TOTAL}, counting each id once.`),
    ],
  },
  {
    id: 'hard-long-reorder-list',
    suite: 'hard',
    prompt:
      'stock.csv lists have and minimum for each SKU. Write reorder.txt with just the SKUs under their minimum, one per line.',
    world: {
      files: {
        'stock.csv': `sku,have,min\n${STOCK.map((s) => `${s.sku},${s.have},${s.min}`).join('\n')}\n`,
      },
    },
    human,
    budget,
    graders: [
      ok,
      fileLines('reorder.txt', LOW.length),
      ...LOW.slice(0, 3).map((s) => fileContains('reorder.txt', s.sku)),
    ],
    reference: [
      [readFile('stock.csv')],
      [writeFile('reorder.txt', LOW.map((s) => s.sku).join('\n'))],
      finish(`reorder.txt lists ${LOW.length} SKUs.`),
    ],
  },
  {
    id: 'hard-long-first-error-after-deploy',
    suite: 'hard',
    prompt:
      'app.log has today’s log. Which request id was the first error after the deploy finished, and what time was it?',
    world: { files: { 'app.log': `${LOG.join('\n')}\n` } },
    human,
    budget,
    graders: [ok, answerContains('z9'), answerContains('12:03:32')],
    reference: [
      [readFile('app.log')],
      finish('The first error after the deploy was req z9 at 12:03:32.'),
    ],
  },
  {
    id: 'hard-long-double-booked',
    suite: 'hard',
    prompt: 'roster.csv lists shifts. Who is booked on two overlapping shifts, and on which day?',
    world: {
      files: {
        'roster.csv': `person,day,start,end\n${range(24)
          .map((i) => `P${i},${['Mon', 'Tue', 'Wed'][i % 3]},${8 + (i % 4)},${12 + (i % 4)}`)
          .join(
            '\n',
          )}\nP7,Thu,9,13\nNia,Fri,9,13\nNia,Fri,12,16\nNia,Sat,9,13\nOwen,Fri,9,12\nOwen,Fri,12,16\n`,
      },
    },
    human,
    budget,
    graders: [
      ok,
      answerContains('Nia'),
      answerContains('Fri'),
      answerLacks(/Owen is (also )?double/i),
    ],
    reference: [
      [readFile('roster.csv')],
      finish('Nia is double-booked on Fri: 9-13 overlaps 12-16.'),
    ],
  },
];
