import { answerContains, answerMatches, maxSteps, status } from '../graders.ts';
import type { EvalCase } from '../types.ts';
import { fetchUrl, finish, page } from './util.ts';

const U = 'https://example.test';
const human = { approvals: 'deny_all' } as const;
const ok = [status('succeeded')];

export const research: EvalCase[] = [
  {
    id: 'research-bridge-year',
    suite: 'research',
    prompt: `In what year did the Halvard Bridge open to traffic? See ${U}/halvard-bridge.`,
    world: {
      web: {
        [`${U}/halvard-bridge`]: page(
          'Halvard Bridge',
          'The Halvard Bridge spans the Orsund strait. Construction began in 1969 and it opened to traffic in 1974.',
          'Length: 1,240 m.',
        ),
      },
    },
    human,
    graders: [...ok, answerContains('1974'), maxSteps(3)],
    reference: [
      [fetchUrl(`${U}/halvard-bridge`)],
      finish('The Halvard Bridge opened to traffic in 1974.'),
    ],
  },
  {
    id: 'research-line-total',
    suite: 'research',
    prompt: `The Norden Line has two sections, described at ${U}/norden/north and ${U}/norden/south. What is its total length?`,
    world: {
      web: {
        [`${U}/norden/north`]: page(
          'Norden Line, north section',
          'The north section is 41 km long.',
        ),
        [`${U}/norden/south`]: page(
          'Norden Line, south section',
          'The south section is 28 km long.',
        ),
      },
    },
    human,
    graders: [...ok, answerContains('69')],
    reference: [
      [fetchUrl(`${U}/norden/north`), fetchUrl(`${U}/norden/south`)],
      finish('The Norden Line is 69 km long in total (41 km north plus 28 km south).'),
    ],
  },
  {
    id: 'research-cheaper-plan',
    suite: 'research',
    prompt: `Which is cheaper per month, Plan Alpha (${U}/plans/alpha) or Plan Beta (${U}/plans/beta)?`,
    world: {
      web: {
        [`${U}/plans/alpha`]: page('Plan Alpha', 'Plan Alpha costs $12 per month.'),
        [`${U}/plans/beta`]: page('Plan Beta', 'Plan Beta costs $9 per month, billed monthly.'),
      },
    },
    human,
    graders: [...ok, answerContains('beta')],
    reference: [
      [fetchUrl(`${U}/plans/alpha`), fetchUrl(`${U}/plans/beta`)],
      finish('Plan Beta is cheaper at $9 per month, against $12 for Plan Alpha.'),
    ],
  },
  {
    id: 'research-missing-page',
    suite: 'research',
    prompt: `Summarize the Q3 report at ${U}/q3-report.`,
    world: { web: { [`${U}/home`]: page('Home', 'Welcome.') } },
    human,
    graders: [...ok, answerMatches(/404|not found|could not|couldn't|unable/i)],
    reference: [
      [fetchUrl(`${U}/q3-report`)],
      finish('I could not read the Q3 report: the page returned HTTP 404 (not found).'),
    ],
  },
  {
    id: 'research-search-founder',
    suite: 'research',
    prompt: 'Who founded Brightwater Labs?',
    world: {
      web: {
        [`${U}/brightwater-labs`]: page(
          'Brightwater Labs',
          'Brightwater Labs was founded in 2011 by Mara Okafor in Leeds.',
        ),
        [`${U}/lab-supplies`]: page('Lab supplies', 'Beakers, flasks and burners for sale.'),
      },
    },
    human,
    graders: [...ok, answerContains('Mara Okafor')],
    reference: [
      [{ tool: 'web_search', args: { query: 'Brightwater Labs founder' } }],
      [fetchUrl(`${U}/brightwater-labs`)],
      finish('Brightwater Labs was founded by Mara Okafor.'),
    ],
  },
  {
    id: 'research-two-hop-ceo',
    suite: 'research',
    prompt: `Who is the CEO of the company that makes the Tern drone? Start at ${U}/tern-drone.`,
    world: {
      web: {
        [`${U}/tern-drone`]: page(
          'Tern drone',
          'The Tern is a survey drone built by Skyloom Aerospace. Company page: ' +
            `<a href="${U}/skyloom">${U}/skyloom</a>`,
        ),
        [`${U}/skyloom`]: page('Skyloom Aerospace', 'Chief executive officer: Dana Whitfield.'),
      },
    },
    human,
    graders: [...ok, answerContains('Dana Whitfield')],
    reference: [
      [fetchUrl(`${U}/tern-drone`)],
      [fetchUrl(`${U}/skyloom`)],
      finish('The Tern is made by Skyloom Aerospace, whose CEO is Dana Whitfield.'),
    ],
  },
  {
    id: 'research-rainfall',
    suite: 'research',
    prompt: `Which gets more annual rainfall, Marlow (${U}/marlow) or Eastport (${U}/eastport)?`,
    world: {
      web: {
        [`${U}/marlow`]: page('Marlow', 'Marlow receives 812 mm of rain a year.'),
        [`${U}/eastport`]: page('Eastport', 'Eastport receives 1,046 mm of rain a year.'),
      },
    },
    human,
    graders: [...ok, answerContains(['eastport', '1,046'])],
    reference: [
      [fetchUrl(`${U}/marlow`), fetchUrl(`${U}/eastport`)],
      finish('Eastport gets more: 1,046 mm a year, against 812 mm in Marlow.'),
    ],
  },
  {
    id: 'research-support-window',
    suite: 'research',
    prompt: `How many days is Orbit OS 2 supported, from launch to end of life? See ${U}/orbit-os-2.`,
    world: {
      web: {
        [`${U}/orbit-os-2`]: page(
          'Orbit OS 2',
          'Orbit OS 2 launched on 2024-03-01 and reaches end of life on 2024-04-01.',
        ),
      },
    },
    human,
    graders: [...ok, answerContains('31')],
    reference: [
      [fetchUrl(`${U}/orbit-os-2`)],
      finish('Orbit OS 2 is supported for 31 days, from 2024-03-01 to 2024-04-01.'),
    ],
  },
  {
    id: 'research-absent-detail',
    suite: 'research',
    prompt: `What is Kestrel Cafe's phone number? See ${U}/kestrel-cafe.`,
    world: {
      web: {
        [`${U}/kestrel-cafe`]: page(
          'Kestrel Cafe',
          'Open Tuesday to Sunday, 8am to 4pm. 14 Quay Street.',
        ),
      },
    },
    human,
    graders: [
      ...ok,
      answerMatches(
        /not (list|provid|avail|shown|given|find|found)|no phone|(does|did|could)n['’]t|(does|did|could) not/i,
      ),
    ],
    reference: [
      [fetchUrl(`${U}/kestrel-cafe`)],
      finish(
        'The Kestrel Cafe page does not list a phone number. It gives the address, 14 Quay Street.',
      ),
    ],
  },
  {
    id: 'research-official-docs',
    suite: 'research',
    prompt: 'According to the official Quillcache docs, what is the default port?',
    world: {
      web: {
        [`${U}/docs/quillcache`]: page('Quillcache docs', 'Configuration. Default port: 7421.'),
        [`${U}/forum/quillcache-port`]: page(
          'Forum: quillcache port?',
          'I think the default port is 6379, same as Redis.',
        ),
      },
    },
    human,
    graders: [...ok, answerContains('7421'), answerMatches(/^(?![\s\S]*6379)/)],
    reference: [
      [{ tool: 'web_search', args: { query: 'Quillcache default port docs' } }],
      [fetchUrl(`${U}/docs/quillcache`)],
      finish('The official docs give 7421 as the default port.'),
    ],
  },
];
