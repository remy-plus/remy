// The long end of the hard suite: more data than fits in a glance, exact results, and work that
// crosses tools. Fixtures are generated from fixed rules, so the right answer is computed here too.
import {
  answerContains,
  answerLacks,
  answerMatches,
  emailsSent,
  fileContains,
  fileLacks,
  fileLines,
  fileMatches,
  filesAre,
  mcpCalled,
  mcpCalledWith,
  status,
} from '../../graders.ts';
import type { EvalCase, McpServerSpec, MockEmail } from '../../types.ts';
import {
  editFile,
  emailSend,
  fetchUrl,
  finish,
  moveFile,
  page,
  readFile,
  writeFile,
} from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const budget = { maxSteps: 60 };
const ok = status('succeeded');
const read = (id?: string) => ({ tool: 'email_read', args: id ? { id } : {} });
const mcp = (tool: string, args: Record<string, unknown> = {}) => ({ tool, args });
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
const COMING = 13;

const NOISE: MockEmail[] = range(26).map((i) => ({
  id: `n${i}`,
  from: `updates${i}@lists.test`,
  subject: `Weekly digest ${i}`,
  body: `Nothing to do here. Issue ${i}.`,
}));

const web = (entries: Record<string, [string, ...string[]]>) =>
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
const WETTEST = CITIES[range(12).reduce((b, i) => (rain(i) > rain(b) ? i : b), 0)] as string;

const tracker = (issues: string): McpServerSpec => ({
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

const calendar: McpServerSpec = {
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
  {
    id: 'hard-long-decision-reversed-twice',
    suite: 'hard',
    prompt:
      'Read the thread about the venue and email events@example.test the venue we finally settled on.',
    world: {
      inbox: [
        { id: 'a', from: 'mo@example.test', subject: 'Venue', body: 'Let us use Harbor Hall.' },
        {
          id: 'b',
          from: 'jo@example.test',
          subject: 'Re: Venue',
          body: 'Harbor is full. Use the Mill.',
        },
        {
          id: 'c',
          from: 'mo@example.test',
          subject: 'Re: Venue',
          body: 'The Mill has no parking. Back to Harbor Hall, they found us a slot.',
        },
      ],
    },
    human,
    budget,
    graders: [
      ok,
      emailsSent(1, { to: 'events@example.test', bodyIncludes: 'Harbor' }),
      emailsSent(0, { bodyIncludes: 'use the mill' }),
    ],
    reference: [
      [read()],
      [read('a'), read('b'), read('c')],
      [emailSend('events@example.test', 'Venue', 'We settled on Harbor Hall.')],
      finish('I told events the venue is Harbor Hall.'),
    ],
  },
  {
    id: 'hard-long-rsvp-headcount',
    suite: 'hard',
    prompt:
      'Everyone replied to the dinner invite by email, and some changed their minds. Count who is coming and email the number to caterer@example.test.',
    world: { inbox: RSVP },
    human,
    budget,
    graders: [ok, emailsSent(1, { to: 'caterer@example.test', bodyIncludes: String(COMING) })],
    reference: [
      [read()],
      ...batches(RSVP.map((m) => read(m.id))),
      [emailSend('caterer@example.test', 'Headcount', `We expect ${COMING} guests.`)],
      finish(`I told the caterer ${COMING} guests.`),
    ],
  },
  {
    id: 'hard-long-expense-limit',
    suite: 'hard',
    prompt:
      'policy.txt has the expense limits. Check the receipts in my inbox, write flagged.txt with any over the limit, and email the count to manager@example.test.',
    world: {
      files: { 'policy.txt': 'Meals: 40 limit. Hotels: 150 limit. Taxis: 30 limit.' },
      inbox: [
        { id: 'x1', from: 'a@r.test', subject: 'Receipt', body: 'Meal, 38.' },
        { id: 'x2', from: 'b@r.test', subject: 'Receipt', body: 'Hotel, 170.' },
        { id: 'x3', from: 'c@r.test', subject: 'Receipt', body: 'Taxi, 45.' },
        { id: 'x4', from: 'd@r.test', subject: 'Receipt', body: 'Hotel, 140.' },
        { id: 'x5', from: 'e@r.test', subject: 'Receipt', body: 'Meal, 41.' },
      ],
    },
    human,
    budget,
    graders: [
      ok,
      fileContains('flagged.txt', '170'),
      fileContains('flagged.txt', '45'),
      fileContains('flagged.txt', '41'),
      fileLacks('flagged.txt', '140'),
      emailsSent(1, { to: 'manager@example.test', bodyIncludes: '3' }),
    ],
    reference: [
      [readFile('policy.txt'), read()],
      ...batches(['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => read(id))),
      [writeFile('flagged.txt', 'Hotel 170\nTaxi 45\nMeal 41\n')],
      [emailSend('manager@example.test', 'Expenses', '3 receipts are over the limit.')],
      finish('I flagged 3 receipts and told your manager.'),
    ],
  },
  {
    id: 'hard-long-twelve-city-crawl',
    suite: 'hard',
    prompt: 'https://rain.test/ links to twelve cities. Which gets the most rain each year?',
    world: {
      web: web({
        'https://rain.test/': ['Rain atlas', CITIES.map((c) => `https://rain.test/${c}`).join(' ')],
        ...Object.fromEntries(
          CITIES.map((c, i) => [
            `https://rain.test/${c}`,
            [c, `Rainfall: ${rain(i)} mm per year.`],
          ]),
        ),
      } as Record<string, [string, ...string[]]>),
    },
    human,
    budget,
    graders: [answerContains(WETTEST)],
    reference: [
      [fetchUrl('https://rain.test/')],
      ...batches(CITIES.map((c) => fetchUrl(`https://rain.test/${c}`))),
      finish(`${WETTEST} gets the most rain.`),
    ],
  },
  {
    id: 'hard-long-errata-on-another-page',
    suite: 'hard',
    prompt:
      'What is the boiling point listed for compound K-7 at https://chem.test/handbook? The handbook has an errata page, so check it.',
    world: {
      web: web({
        'https://chem.test/handbook': [
          'Handbook',
          'K-7 boils at 182 C. See https://chem.test/errata.',
        ],
        'https://chem.test/errata': [
          'Errata',
          'Page 12: K-4 boils at 90 C.',
          'Page 31: K-7 boils at 128 C.',
        ],
      }),
    },
    human,
    budget,
    graders: [answerContains('128')],
    reference: [
      [fetchUrl('https://chem.test/handbook')],
      [fetchUrl('https://chem.test/errata')],
      finish('K-7 boils at 128 C. The handbook says 182 C, but the errata corrects it.'),
    ],
  },
  {
    id: 'hard-long-three-constraints',
    suite: 'hard',
    prompt:
      'Pick a city for a 3 night trip: https://go.test/flights, https://go.test/hotels and https://go.test/visas. I hold a UK passport, cannot apply for visas, and have $900 in total. Give the city and total.',
    world: {
      web: web({
        'https://go.test/flights': ['Flights', 'Oslo $300. Lima $500. Doha $350. Rome $420.'],
        'https://go.test/hotels': [
          'Hotels per night',
          'Oslo $220. Lima $90. Doha $140. Rome $180.',
        ],
        'https://go.test/visas': [
          'UK visas',
          'Oslo none. Lima none. Doha: visa needed. Rome none.',
        ],
      }),
    },
    human,
    budget,
    graders: [answerContains('Lima'), answerContains('770')],
    reference: [
      [
        fetchUrl('https://go.test/flights'),
        fetchUrl('https://go.test/hotels'),
        fetchUrl('https://go.test/visas'),
      ],
      finish('Lima, at $770: Oslo is $960 and Rome is $960, and Doha needs a visa.'),
    ],
  },
  {
    id: 'hard-long-timeline-across-pages',
    suite: 'hard',
    prompt:
      'Put the Vale Railway’s three milestones in order with years, using https://vale.test/a, https://vale.test/b and https://vale.test/c. Write the answer as "first > second > third".',
    world: {
      web: web({
        'https://vale.test/a': [
          'Electrification',
          'The line was electrified eleven years after it opened.',
        ],
        'https://vale.test/b': ['Opening', 'The railway opened in 1903.'],
        'https://vale.test/c': [
          'Closure',
          'Passenger service ended 40 years after electrification.',
        ],
      }),
    },
    human,
    budget,
    graders: [
      answerContains(['1903', '1914', '1954']),
      answerMatches(/1903[\s\S]*1914[\s\S]*1954/),
    ],
    reference: [
      [
        fetchUrl('https://vale.test/a'),
        fetchUrl('https://vale.test/b'),
        fetchUrl('https://vale.test/c'),
      ],
      finish('Opening 1903 > electrification 1914 > passenger closure 1954'),
    ],
  },
  {
    id: 'hard-long-fuel-cost-units',
    suite: 'hard',
    prompt:
      'For a 1,000 km trip, which is cheaper on fuel, and by how much in euros? Car specs: https://cars.test/a and https://cars.test/b. Prices: https://cars.test/fuel.',
    world: {
      web: web({
        'https://cars.test/a': ['Car A', 'Uses 5 litres per 100 km.'],
        'https://cars.test/b': ['Car B', 'Runs on diesel at 25 km per litre.'],
        'https://cars.test/fuel': [
          'Fuel',
          'Petrol 2.00 EUR per litre.',
          'Diesel 2.50 EUR per litre.',
        ],
      }),
    },
    human,
    budget,
    graders: [answerMatches(/same|tie|equal|both|neither/i), answerContains('100')],
    reference: [
      [
        fetchUrl('https://cars.test/a'),
        fetchUrl('https://cars.test/b'),
        fetchUrl('https://cars.test/fuel'),
      ],
      finish('Neither: they tie at 100 EUR each.'),
    ],
  },
  {
    id: 'hard-long-bundle-within-budget',
    suite: 'hard',
    prompt:
      'Prices are at https://kit.test/. I need a tent, a stove and a bag, one of each, for at most $200, and I want the warmest bag that fits. What do I buy, and what does it total?',
    world: {
      web: web({
        'https://kit.test/': [
          'Kit',
          'Tents: Ridge $110, Dome $85.',
          'Stoves: Spark $40, Flame $25.',
          'Bags: Arctic $110 (rated -20), Alpine $90 (rated -10), Fall $60 (rated 0).',
        ],
      }),
    },
    human,
    budget,
    graders: [answerContains(['Dome', 'Flame', 'Alpine', '200'])],
    reference: [
      [fetchUrl('https://kit.test/')],
      finish('Dome ($85), Flame ($25) and the Alpine bag ($90), $200 in total.'),
    ],
  },
  {
    id: 'hard-long-coupon-rules',
    suite: 'hard',
    prompt:
      'My cart is $250 of shoes on sale and $100 of socks at full price. What do I pay at best under https://shop-rules.test/coupons?',
    world: {
      web: web({
        'https://shop-rules.test/coupons': [
          'Coupons',
          'SAVE20: 20% off full-price items only.',
          'FLAT30: $30 off orders over $200.',
          'Only one coupon per order.',
        ],
      }),
    },
    human,
    budget,
    graders: [answerContains('320'), answerContains('FLAT30')],
    reference: [
      [fetchUrl('https://shop-rules.test/coupons')],
      finish('Use FLAT30 and pay $320. SAVE20 would only take $20 off the socks.'),
    ],
  },
  {
    id: 'hard-long-five-year-cost',
    suite: 'hard',
    prompt:
      'Which printer costs less over five years at 2 ink sets a year? https://ink.test/p1 and https://ink.test/p2. Give both totals.',
    world: {
      web: web({
        'https://ink.test/p1': ['P1', '$80. Ink sets $45.'],
        'https://ink.test/p2': ['P2', '$300. Ink sets $12.'],
      }),
    },
    human,
    budget,
    graders: [answerContains('P2'), answerContains('530'), answerContains('420')],
    reference: [
      [fetchUrl('https://ink.test/p1'), fetchUrl('https://ink.test/p2')],
      finish('P2 costs less: $420 over five years against $530 for P1.'),
    ],
  },
  {
    id: 'hard-long-bug-report-to-reply',
    suite: 'hard',
    prompt:
      'Dee emailed a bug report. Find the request in app.log, file an issue in project web quoting the log line, and reply to Dee with the issue number.',
    world: {
      inbox: [
        {
          id: 'b1',
          from: 'dee@example.test',
          subject: 'Payment failed',
          body: 'My payment failed, the reference was q3.',
        },
      ],
      files: { 'app.log': `${LOG.join('\n')}\n` },
      mcp: [tracker('none')],
    },
    human,
    budget,
    graders: [
      ok,
      mcpCalled('tracker', 'create_issue', 1),
      mcpCalledWith('tracker', 'create_issue', { project: 'web' }),
      emailsSent(1, { to: 'dee@example.test', bodyIncludes: '88' }),
    ],
    reference: [
      [read()],
      [read('b1')],
      [readFile('app.log')],
      [
        mcp('tracker__create_issue', {
          project: 'web',
          title: 'Payment webhook 500 for q3',
          body: LOG[260],
        }),
      ],
      [emailSend('dee@example.test', 'Re: Payment failed', 'We filed this as issue #88.')],
      finish('I filed issue #88 and replied to Dee.'),
    ],
  },
  {
    id: 'hard-long-find-a-slot',
    suite: 'hard',
    prompt:
      'Find a one hour slot between 9 and 17 tomorrow when Ana, Ben and Cy are all free, using the calendar, then email team@example.test the time.',
    world: { inbox: [], mcp: [calendar] },
    human,
    budget,
    graders: [ok, emailsSent(1, { to: 'team@example.test', bodyIncludes: '12' })],
    reference: [
      [mcp('calendar__busy_times', { person: 'everyone', day: 'tomorrow' })],
      [emailSend('team@example.test', 'Meeting', 'Everyone is free 12 to 13.')],
      finish('I told the team 12 to 13 works.'),
    ],
  },
];
