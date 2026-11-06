import { answerContains, answerMatches } from '../../graders.ts';
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
];
