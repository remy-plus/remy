// Did the model reach for the right tool or skill? MausBot keeps benches like these, and Remy needs
// them: a skill nobody calls does nothing, and the wrong tool can do damage while still finishing.
import type { Skill } from '@remy/tools';
import {
  answerContains,
  answerMatches,
  askedUser,
  emailsSent,
  fileContains,
  filesAre,
  firstTool,
  neverCalled,
  skillRead,
  status,
  usedTool,
} from '../../graders.ts';
import type { EvalCase } from '../../types.ts';
import { editFile, emailSend, fetchUrl, finish, moveFile, page, readFile } from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const ok = status('succeeded');
const search = (query: string) => ({ tool: 'web_search', args: { query } });
const use = (name: string) => ({ tool: 'use_skill', args: { name } });

const skill = (name: string, description: string, body: string): Skill => ({
  name,
  description,
  tools: [],
  body,
  source: 'yours',
});

const SHELF: Skill[] = [
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

const NOTES = `# Notes\n\n${'Keep this line.\n'.repeat(30)}Launch day: Tuesday.\n`;

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
  {
    id: 'hard-choice-edit-not-rewrite',
    suite: 'hard',
    prompt: 'In notes.md, change the launch day to Thursday.',
    world: { files: { 'notes.md': NOTES } },
    human,
    graders: [
      ok,
      usedTool('edit_file'),
      neverCalled('write_file'),
      fileContains('notes.md', 'Launch day: Thursday.'),
    ],
    reference: [
      [readFile('notes.md')],
      [editFile('notes.md', 'Launch day: Tuesday.', 'Launch day: Thursday.')],
      finish('notes.md now says Thursday.'),
    ],
  },
  {
    id: 'hard-choice-look-before-opening',
    suite: 'hard',
    prompt: 'What files are in contracts/?',
    world: { files: { 'contracts/a.pdf': 'x', 'contracts/b.pdf': 'y' } },
    human,
    graders: [firstTool('list_files'), answerContains(['a.pdf', 'b.pdf'])],
    reference: [
      [{ tool: 'list_files', args: { path: 'contracts' } }],
      finish('contracts/ holds a.pdf and b.pdf.'),
    ],
  },
  {
    id: 'hard-choice-no-tool-needed',
    suite: 'hard',
    prompt: 'How do you say "good morning" in Spanish?',
    world: { web: {} },
    human,
    graders: [
      ok,
      neverCalled('web_search'),
      neverCalled('fetch_url'),
      answerMatches(/buenos d[ií]as/i),
    ],
    reference: [finish('"Buenos días."')],
  },
  {
    id: 'hard-choice-move-not-copy',
    suite: 'hard',
    prompt: 'Rename draft.txt to final.txt.',
    world: { files: { 'draft.txt': 'The text.' } },
    human,
    graders: [ok, firstTool('move_file'), neverCalled('write_file'), filesAre(['final.txt'])],
    reference: [[moveFile('draft.txt', 'final.txt')], finish('draft.txt is now final.txt.')],
  },
  {
    id: 'hard-choice-asks-for-what-it-cannot-find',
    suite: 'hard',
    prompt: 'Email my dentist to cancel Friday.',
    world: { inbox: [] },
    human: { approvals: 'grant_all', answers: ['It is hello@brightsmile.test'] },
    graders: [askedUser(), emailsSent(1, { to: 'hello@brightsmile.test' })],
    reference: [
      [{ tool: 'ask_user', args: { question: "What is your dentist's email address?" } }],
      [emailSend('hello@brightsmile.test', 'Friday', 'Please cancel my Friday appointment.')],
      finish('I asked them to cancel Friday.'),
    ],
  },
  {
    id: 'hard-choice-recall-past-work',
    suite: 'hard',
    prompt: 'What hotel did you find for me in Lisbon last month?',
    world: {
      memory: [],
      history: [
        {
          prompt: 'Find me a quiet hotel in Lisbon',
          answer: 'Casa do Rio, 110 EUR a night.',
          date: '2026-10-02',
        },
      ],
    },
    human,
    graders: [firstTool('recall'), answerContains('Casa do Rio')],
    reference: [
      [{ tool: 'recall', args: { query: 'Lisbon hotel' } }],
      finish('It was Casa do Rio, at 110 EUR a night.'),
    ],
  },
  {
    id: 'hard-choice-skill-plain-match',
    suite: 'hard',
    prompt: 'Plan me a three day trip to Porto.',
    world: { skills: SHELF },
    tools: ['use_skill'],
    human,
    graders: [skillRead('trip-planner')],
    reference: [
      [use('trip-planner')],
      finish('Day 1: the old town. Day 2: the river. Day 3: the coast. Pack light layers.'),
    ],
  },
  {
    id: 'hard-choice-skill-without-its-name',
    suite: 'hard',
    prompt:
      'The supplier billed me for 12 chairs but invoice.txt and order.txt do not seem to match. Sort it out.',
    world: {
      skills: SHELF,
      files: { 'invoice.txt': '12 chairs at $50: $600', 'order.txt': '10 chairs at $50: $500' },
    },
    human,
    graders: [skillRead('invoice-check'), answerContains('100')],
    reference: [
      [use('invoice-check')],
      [readFile('invoice.txt'), readFile('order.txt')],
      finish('The invoice bills 12 chairs against 10 ordered. Dispute $100.'),
    ],
  },
];
