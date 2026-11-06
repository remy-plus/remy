// The long end of the hard suite: more data than fits in a glance, exact results, and work that
// crosses tools. Fixtures are generated from fixed rules, so the right answer is computed here too.
import {
  answerContains,
  answerLacks,
  answerMatches,
  fileContains,
  fileLacks,
  fileLines,
  fileMatches,
  filesAre,
  status,
} from '../../graders.ts';
import type { EvalCase, McpServerSpec, MockEmail } from '../../types.ts';
import { editFile, finish, moveFile, page, readFile, writeFile } from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const budget = { maxSteps: 60 };
const ok = status('succeeded');
const read = (id?: string) => ({ tool: 'email_read', args: id ? { id } : {} });
const _mcp = (tool: string, args: Record<string, unknown> = {}) => ({ tool, args });
const range = (n: number) => [...Array(n).keys()];
/** Remy runs at most four calls in a step, so a plan reads in batches. */
const batches = <T>(xs: T[]) =>
  range(Math.ceil(xs.length / 4)).map((b) => xs.slice(b * 4, b * 4 + 4));
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
const SALES_TOTAL = range(12).reduce((a, i) => a + sales(i), 0);
const BEST = MONTHS[range(12).reduce((b, i) => (sales(i) > sales(b) ? i : b), 0)] as string;

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

const NOISE: MockEmail[] = range(26).map((i) => ({
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
  {
    id: 'hard-long-rename-twenty',
    suite: 'hard',
    prompt: 'Rename every photo in shots/ from IMG_N.jpg to trip-NNN.jpg, padded to three digits.',
    world: {
      files: Object.fromEntries(range(20).map((i) => [`shots/IMG_${i + 1}.jpg`, `p${i}`])),
    },
    human,
    budget,
    graders: [
      ok,
      filesAre(range(20).map((i) => `shots/trip-${String(i + 1).padStart(3, '0')}.jpg`)),
    ],
    reference: [
      [{ tool: 'list_files', args: { path: 'shots' } }],
      ...batches(range(20).map((i) => i + 1)).map((ns) =>
        ns.map((n) =>
          moveFile(`shots/IMG_${n}.jpg`, `shots/trip-${String(n).padStart(3, '0')}.jpg`),
        ),
      ),
      finish('I renamed all 20 photos.'),
    ],
  },
  {
    id: 'hard-long-twelve-month-files',
    suite: 'hard',
    prompt: 'sales/ has one file per month. What is the year’s total, and which month was best?',
    world: {
      files: Object.fromEntries(
        MONTHS.map((m, i) => [`sales/${m}.txt`, `Sales for ${m}: ${sales(i)}`]),
      ),
    },
    human,
    budget,
    graders: [ok, answerContains(String(SALES_TOTAL)), answerMatches(new RegExp(BEST, 'i'))],
    reference: [
      [{ tool: 'list_files', args: { path: 'sales' } }],
      ...batches(MONTHS.map((m) => readFile(`sales/${m}.txt`))),
      finish(`The year's total is ${SALES_TOTAL} and ${BEST} was best.`),
    ],
  },
  {
    id: 'hard-long-rename-across-files',
    suite: 'hard',
    prompt:
      'Rename the function getUser to fetchUser everywhere in src/. Leave vendor/ alone, and leave the string "getUser is deprecated" in src/notes.ts as it is.',
    world: {
      files: {
        'src/a.ts': 'export function getUser() {}\n',
        'src/b.ts': "import { getUser } from './a';\ngetUser();\n",
        'src/notes.ts': 'export const note = "getUser is deprecated";\n',
        'vendor/lib.ts': 'export function getUser() {}\n',
      },
    },
    human,
    budget,
    graders: [
      ok,
      fileContains('src/a.ts', 'fetchUser'),
      fileLacks('src/b.ts', 'getUser'),
      fileContains('src/notes.ts', 'getUser is deprecated'),
      fileContains('vendor/lib.ts', 'getUser'),
    ],
    reference: [
      [{ tool: 'list_files', args: { path: 'src' } }],
      [readFile('src/a.ts'), readFile('src/b.ts'), readFile('src/notes.ts')],
      [
        editFile('src/a.ts', 'getUser', 'fetchUser'),
        writeFile('src/b.ts', "import { fetchUser } from './a';\nfetchUser();\n"),
      ],
      finish('I renamed getUser in a.ts and b.ts and left vendor and the note alone.'),
    ],
  },
  {
    id: 'hard-long-deadline-in-noise',
    suite: 'hard',
    prompt: 'What is the earliest deadline still standing in my inbox? Read everything.',
    world: {
      inbox: [
        ...NOISE,
        {
          id: 'd1',
          from: 'tax@example.test',
          subject: 'Filing',
          body: 'Your filing is due 12 March.',
        },
        {
          id: 'd2',
          from: 'gym@example.test',
          subject: 'Renewal',
          body: 'Renew your membership by 2 March.',
        },
        {
          id: 'd3',
          from: 'gym@example.test',
          subject: 'Re: Renewal',
          body: 'Ignore our last email, your membership already renewed itself.',
        },
        {
          id: 'd4',
          from: 'school@example.test',
          subject: 'Forms',
          body: 'Forms by 9 March please.',
        },
      ],
    },
    human,
    budget,
    graders: [ok, answerContains('9 March')],
    reference: [
      [read()],
      [read('d1'), read('d2'), read('d3'), read('d4')],
      finish('The earliest standing deadline is 9 March, for the school forms.'),
    ],
  },
];
