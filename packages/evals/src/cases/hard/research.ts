import { answerContains, answerLacks, answerMatches } from '../../graders.ts';
import type { EvalCase } from '../../types.ts';
import { fetchUrl, finish, page } from '../util.ts';

const human = { approvals: 'deny_all' } as const;

export const research: EvalCase[] = [
  {
    id: 'hard-research-sources-disagree',
    suite: 'hard',
    prompt:
      'What year did the Tessel Ferry start running? Check https://travelblog.test/tessel and https://tessel-archive.test/ferry, tell me which source you trust, and why.',
    world: {
      web: {
        'https://travelblog.test/tessel': page(
          'A weekend on Tessel',
          'A lovely trip. The ferry has been running since about 1981, I think.',
        ),
        'https://tessel-archive.test/ferry': page(
          'Tessel municipal archive: ferry records',
          'Council minutes show the first scheduled crossing on 4 May 1983.',
        ),
      },
    },
    human,
    graders: [answerContains('1983'), answerMatches(/archive|council|minutes|municipal/i)],
    reference: [
      [fetchUrl('https://travelblog.test/tessel'), fetchUrl('https://tessel-archive.test/ferry')],
      finish(
        'It started in 1983. I trust the municipal archive: it cites council minutes, while the blog only guesses at 1981.',
      ),
    ],
  },
  {
    id: 'hard-research-three-hops',
    suite: 'hard',
    prompt:
      'Start at https://orbis.test/about. Find who founded Orbis Freight, then the town that person was born in, then that town’s population.',
    world: {
      web: {
        'https://orbis.test/about': page(
          'About Orbis Freight',
          'Founded by Mirela Vance. Read her story at https://people.test/vance.',
        ),
        'https://people.test/vance': page(
          'Mirela Vance',
          'Born in Karsa in 1961. The town is described at https://towns.test/karsa.',
        ),
        'https://towns.test/karsa': page('Karsa', 'Karsa has a population of 48,200.'),
      },
    },
    human,
    graders: [answerContains(['Vance', 'Karsa', '48,200'])],
    reference: [
      [fetchUrl('https://orbis.test/about')],
      [fetchUrl('https://people.test/vance')],
      [fetchUrl('https://towns.test/karsa')],
      finish('Mirela Vance founded Orbis Freight. She was born in Karsa, population 48,200.'),
    ],
  },
  {
    id: 'hard-research-currency-total',
    suite: 'hard',
    prompt:
      'The trip costs are at https://trip.test/costs and the exchange rate is at https://fx.test/today. What is the total in dollars?',
    world: {
      web: {
        'https://trip.test/costs': page('Trip costs', 'Hotel: 400 EUR.', 'Train: 120 EUR.'),
        'https://fx.test/today': page('Rates today', '1 EUR = 1.10 USD.', '1 GBP = 1.30 USD.'),
      },
    },
    human,
    graders: [answerContains('572')],
    reference: [
      [fetchUrl('https://trip.test/costs'), fetchUrl('https://fx.test/today')],
      finish('The total is $572 (520 EUR at 1.10).'),
    ],
  },
  {
    id: 'hard-research-stale-page',
    suite: 'hard',
    prompt:
      'What does the Linden Library charge per day for a late book? See https://linden.test/fees and https://linden.test/news.',
    world: {
      web: {
        'https://linden.test/fees': page(
          'Fees (updated March 2019)',
          'Late books cost 25 cents per day.',
        ),
        'https://linden.test/news': page(
          'Library news, January 2026',
          'From 1 February 2026, late fees rise to 40 cents per day.',
        ),
      },
    },
    human,
    graders: [answerMatches(/40\s*(cents|¢)|\$0\.40/i)],
    reference: [
      [fetchUrl('https://linden.test/fees'), fetchUrl('https://linden.test/news')],
      finish('It charges 40 cents per day, since 1 February 2026. The fees page is out of date.'),
    ],
  },
  {
    id: 'hard-research-not-in-sources',
    suite: 'hard',
    prompt:
      'How many staff did Pellam Foods employ in 2024? Use https://pellam.test/report and do not guess.',
    world: {
      web: {
        'https://pellam.test/report': page(
          'Pellam Foods annual report',
          'Revenue in 2024 was 12 million. The firm runs 9 shops. In 2021 it employed 210 staff.',
        ),
      },
    },
    human,
    graders: [
      answerMatches(
        /not (say|state|give|list|include|report)|does(n['’]t| not)|no 2024|could(n['’]t| not)/i,
      ),
      answerLacks(/employed \d+ staff in 2024/i),
    ],
    reference: [
      [fetchUrl('https://pellam.test/report')],
      finish('The report does not give a 2024 staff number. The latest it gives is 210 in 2021.'),
    ],
  },
];
