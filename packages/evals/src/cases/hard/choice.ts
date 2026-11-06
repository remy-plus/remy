// Did the model reach for the right tool or skill? MausBot keeps benches like these, and Remy needs
// them: a skill nobody calls does nothing, and the wrong tool can do damage while still finishing.
import type { Skill } from '@remy/tools';
import { answerContains, firstTool, status } from '../../graders.ts';
import type { EvalCase } from '../../types.ts';
import { fetchUrl, finish, page } from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const _ok = status('succeeded');
const search = (query: string) => ({ tool: 'web_search', args: { query } });
const _use = (name: string) => ({ tool: 'use_skill', args: { name } });

const skill = (name: string, description: string, body: string): Skill => ({
  name,
  description,
  tools: [],
  body,
  source: 'yours',
});

const _SHELF: Skill[] = [
  skill(
    'trip-planner',
    'Plan a trip: flights, hotels and a day-by-day route',
    '1. Ask nothing you can look up.\n2. Lay out each day.\n3. Finish with a packing line.',
  ),
  skill(
    'invoice-check',
    'Check an invoice against what was ordered',
    '1. Read the invoice and the order.\n2. List every line that differs.\n3. Say the amount to dispute.',
  ),
  skill(
    'weekly-report',
    'Write the weekly status report for the team',
    '1. Start with what shipped.\n2. Then what is blocked.\n3. Keep it under five lines.',
  ),
  skill(
    'monthly-report',
    'Write the monthly report for investors',
    '1. Start with revenue.\n2. Then the headcount.\n3. End with the ask.',
  ),
];

const _NOTES = `# Notes\n\n${'Keep this line.\n'.repeat(30)}Launch day: Tuesday.\n`;

export const choice: EvalCase[] = [
  {
    id: 'hard-choice-given-url-is-fetched',
    suite: 'hard',
    prompt: 'What does https://docs.test/limits say the upload limit is?',
    world: {
      web: { 'https://docs.test/limits': page('Limits', 'Uploads are limited to 25 MB.') },
    },
    human,
    graders: [firstTool('fetch_url'), answerContains('25')],
    reference: [[fetchUrl('https://docs.test/limits')], finish('The upload limit is 25 MB.')],
  },
  {
    id: 'hard-choice-no-url-is-searched',
    suite: 'hard',
    prompt: 'What is the upload limit in the Tessera docs?',
    world: {
      web: { 'https://tessera.test/limits': page('Tessera limits', 'Uploads stop at 40 MB.') },
    },
    human,
    graders: [firstTool('web_search'), answerContains('40')],
    reference: [
      [search('Tessera upload limit')],
      [fetchUrl('https://tessera.test/limits')],
      finish('Tessera uploads stop at 40 MB.'),
    ],
  },
];
