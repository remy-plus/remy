// Which tool or skill does the model reach for? Each case is one plain request with the normal
// tools on offer, scored on the model's first reply only: one model call per case when run live.
// The graders read `firstReply`, so nothing a tool would do matters. Prompts stay distinct from
// each other: a cassette is keyed on the request.
import { BROWSER_TOOL_NAMES } from '@remy/browser';
import { BUILTIN_SKILLS } from '@remy/tools';
import { choseSkill, choseTool } from '../graders.ts';
import type { EvalCase, Grader, Move } from '../types.ts';
import { fetchUrl, finish } from './util.ts';

const search = (query: string) => ({ tool: 'web_search', args: { query } });

const call = (tool: string, args: unknown = {}) => ({ tool, args });

const use = (name: string) => call('use_skill', { name });

const NOTES = [{ text: 'Lives in Lisbon.' }, { text: 'Prefers short answers.' }];
const HISTORY = [
  {
    prompt: 'Find me a hotel in Lisbon for the first week of October.',
    answer: 'Casa do Rio, 110 EUR a night, near Alfama.',
    date: '2026-10-02T09:00:00.000Z',
  },
  {
    prompt: 'Suggest a vegetarian dinner place in Porto.',
    answer: 'Verde Vivo, on Rua das Flores.',
    date: '2026-10-20T18:00:00.000Z',
  },
];

/** What a normal install offers: web, files, notes, schedules, the built-in skills and a shell. */
const kit = (over: Partial<EvalCase['world']> = {}): EvalCase['world'] => ({
  web: {},
  files: { 'notes.txt': 'Launch is on Tuesday.\n', 'draft.txt': 'First draft.\n' },
  memory: NOTES,
  history: HISTORY,
  schedules: true,
  skills: BUILTIN_SKILLS,
  shell: true,
  ...over,
});

/** One case: the first reply must satisfy `want`. `first` is what the reference model replies with. */
const pick = (
  id: string,
  prompt: string,
  want: Grader,
  first: Move,
  over: Partial<EvalCase> = {},
): EvalCase => ({
  id: `choice-${id}`,
  suite: 'choice',
  prompt,
  firstReplyOnly: true,
  world: kit(),
  human: { approvals: 'deny_all' },
  graders: [want],
  reference: [first, finish('Done.')],
  ...over,
});

const web: EvalCase[] = [
  pick(
    'fetch-given-address',
    'Summarise https://example.test/pricing for me.',
    choseTool({ any: ['fetch_url'], not: ['web_search'] }),
    [fetchUrl('https://example.test/pricing')],
  ),
  pick(
    'search-no-address',
    'Who won the men’s Tour de France in 2025?',
    choseTool({ any: ['web_search'], not: ['fetch_url'] }),
    [search('Tour de France 2025 winner')],
  ),
  // "Open the docs" sounds like fetching, but there is no address and none may come from memory.
  pick(
    'search-open-the-docs',
    'Open the Zod docs and tell me what z.coerce does.',
    choseTool({ any: ['web_search'], not: ['fetch_url'] }),
    [search('zod z.coerce docs')],
  ),
  // "Check ... newer" sounds like a search, but the page is named.
  pick(
    'fetch-check-a-named-page',
    'Check https://example.test/changelog and tell me if anything is newer than 2.4.',
    choseTool({ any: ['fetch_url', 'browser_open'], not: ['web_search'] }),
    [fetchUrl('https://example.test/changelog')],
  ),
];

const BROWSER_WORLD = kit({ browser: {} });
const browserCase = (
  id: string,
  prompt: string,
  want: Grader,
  first: Move,
  over: Partial<EvalCase> = {},
) =>
  pick(id, prompt, want, first, {
    world: BROWSER_WORLD,
    tools: [
      ...BROWSER_TOOL_NAMES,
      'fetch_url',
      'calculate',
      'update_plan',
      'read_file',
      'list_files',
    ],
    ...over,
  });

const browserPick: EvalCase[] = [
  browserCase(
    'fetch-static-article',
    'Read the post at https://example.test/blog/hello-world and give me the gist.',
    choseTool({ any: ['fetch_url'] }),
    [fetchUrl('https://example.test/blog/hello-world')],
  ),
  browserCase(
    'browser-script-page',
    'Open https://example.test/app/dashboard, a single-page app that fills in its numbers with JavaScript, and tell me today’s signups.',
    choseTool({ any: ['browser_open'], not: ['fetch_url'] }),
    [call('browser_open', { url: 'https://example.test/app/dashboard' })],
  ),
  browserCase(
    'browser-signed-in-site',
    'Which of my sites failed its last deploy? I am signed in at https://app.example.test/sites.',
    choseTool({ any: ['browser_open', 'browser_show'], not: ['fetch_url'] }),
    [call('browser_open', { url: 'https://app.example.test/sites' })],
  ),
  // "Fetch" sounds like fetch_url, but an account page needs the signed-in browser.
  browserCase(
    'browser-fetch-my-orders',
    'Fetch my order status from https://shop.example.test/account/orders, where I am signed in.',
    choseTool({ any: ['browser_open', 'browser_show'], not: ['fetch_url'] }),
    [call('browser_open', { url: 'https://shop.example.test/account/orders' })],
  ),
];

const calc = (expression: string) => call('calculate', { op: 'eval', expression });

const sums: EvalCase[] = [
  pick('calculate-percentage', 'What is 18.5% of 2,340,000?', choseTool({ any: ['calculate'] }), [
    calc('2340000 * 0.185'),
  ]),
  // The dates are in the prompt, so a search would only add noise.
  pick(
    'calculate-days-between',
    'How many days are there from 1 March 2026 to 6 November 2026?',
    choseTool({ any: ['calculate'], not: ['web_search'] }),
    [call('calculate', { op: 'days_between', from: '2026-03-01', to: '2026-11-06' })],
  ),
  // A plain reply would do the sum in its head.
  pick(
    'calculate-split-the-bill',
    'We are seven at dinner and the bill is 482.60 with an 18% tip. What does each person pay?',
    choseTool({ any: ['calculate'] }),
    [calc('482.60 * 1.18 / 7')],
  ),
];

const recallPick: EvalCase[] = [
  pick(
    'recall-last-months-hotel',
    'What was the name of the hotel you found for me in Lisbon last month?',
    choseTool({ any: ['recall'], not: ['web_search'] }),
    [call('recall', { query: 'Lisbon hotel' })],
  ),
  pick(
    'recall-something-i-said',
    'What did I tell you about where I live?',
    choseTool({ any: ['recall'], not: ['web_search'] }),
    [call('recall', { query: 'where the user lives' })],
  ),
  // "Find" sounds like a search, but the restaurant is already in the past tasks.
  pick(
    'recall-find-the-dinner-place',
    'Find the vegetarian restaurant you suggested in Porto again.',
    choseTool({ any: ['recall'], not: ['web_search'] }),
    [call('recall', { query: 'vegetarian restaurant Porto' })],
  ),
];

const remember = (text: string) => call('remember', { text, kind: 'preference' });

const rememberPick: EvalCase[] = [
  pick(
    'remember-a-preference',
    'Remember that I prefer window seats on flights.',
    choseTool({ any: ['remember'] }),
    [remember('Prefers window seats on flights.')],
  ),
  pick(
    'remember-a-name',
    'From now on call me Sam, not Samuel.',
    choseTool({ any: ['remember'] }),
    [remember('Goes by Sam, not Samuel.')],
  ),
  // "Note" sounds like writing a file, but this is something for Remy to keep.
  pick(
    'remember-note-for-yourself',
    'Note for yourself: my sister’s birthday is 3 May.',
    choseTool({ any: ['remember'], not: ['write_file'] }),
    [remember('Sister’s birthday is 3 May.')],
  ),
  // And the other way: they asked for a file.
  pick(
    'write-file-when-asked',
    'Put my packing list (passport, charger, umbrella) into a file called packing.txt.',
    choseTool({ any: ['write_file'], not: ['remember'] }),
    [call('write_file', { path: 'packing.txt', content: 'passport\ncharger\numbrella\n' })],
  ),
];

// A shell is on offer in every case; a built-in tool that fits must win over it.
const noShell = { not: ['run_command'] };

const builtinsOverShell: EvalCase[] = [
  pick(
    'file-show-contents',
    'Show me what is in notes.txt.',
    choseTool({ any: ['read_file'], ...noShell }),
    [call('read_file', { path: 'notes.txt' })],
  ),
  pick(
    'file-list-workspace',
    'What files do I have in my workspace right now?',
    choseTool({ any: ['list_files'], ...noShell }),
    [call('list_files', { path: '.' })],
  ),
  pick(
    'file-rename',
    'Rename draft.txt to final.txt.',
    choseTool({ any: ['move_file'], ...noShell }),
    [call('move_file', { from: 'draft.txt', to: 'final.txt' })],
  ),
];

const when = (spec: string, prompt: string) => call('schedule_task', { when: spec, prompt });

const schedulePick: EvalCase[] = [
  pick(
    'schedule-every-weekday',
    'Every weekday at 8am, send me a short summary of the top AI news.',
    choseTool({ any: ['schedule_task'] }),
    [when('every weekday at 08:00', 'Summarise the top AI news in a few lines.')],
  ),
  pick(
    'schedule-a-reminder',
    'Remind me tomorrow at 9 to call the dentist.',
    choseTool({ any: ['schedule_task'] }),
    [when('2026-11-07 09:00', 'Remind the user to call the dentist.')],
  ),
  // Sounds like a one-off lookup, but "every Monday" is a standing request.
  pick(
    'schedule-watch-a-price',
    'Look at the bridge toll price each Monday morning and tell me if it changed.',
    choseTool({ any: ['schedule_task'] }),
    [when('every Monday at 08:00', 'Check the bridge toll price and say if it changed.')],
  ),
  // "Sundays" and "how often" do not make it recurring: they want one answer now.
  pick(
    'search-bus-times-once',
    'How often does the number 42 bus run on Sundays? I only need to know once.',
    choseTool({ any: ['web_search'], not: ['schedule_task'] }),
    [search('bus 42 Sunday timetable')],
  ),
];

const skillPick: EvalCase[] = [
  pick(
    'skill-research-differences',
    'What are the main differences between Postgres 17 and Postgres 18? I want sources.',
    choseSkill('research'),
    [use('research')],
  ),
  // A claim to check is research, even with no one asking for "research".
  pick(
    'skill-research-check-a-claim',
    'Is it true that the Great Wall of China can be seen from space? Show me where that is from.',
    choseSkill('research'),
    [use('research')],
  ),
  pick(
    'skill-research-what-is-known',
    'Find out what is known about the safety of creatine for teenagers.',
    choseSkill('research'),
    [use('research')],
  ),
  pick(
    'skill-compare-two-phones',
    'Fairphone 5 or Pixel 9a: which should I get? Pick one and help me buy it.',
    choseSkill('compare-and-buy'),
    [use('compare-and-buy')],
  ),
  // Shopping with no "compare" in it. A search tool alone would find a page, not a pick.
  pick(
    'skill-compare-best-deal',
    'I need a standing desk for under 400 euros. Find me the best deal.',
    choseSkill('compare-and-buy'),
    [use('compare-and-buy')],
  ),
  pick(
    'skill-write-and-send-email',
    'Write an email to Priya saying the launch moved to Thursday, and send it once I have seen it.',
    choseSkill('write-and-send'),
    [use('write-and-send')],
    { world: kit({ inbox: [] }) },
  ),
  // Short and casual, with no word like "email" or "draft".
  pick(
    'skill-write-and-send-reply',
    'Tell the landlord I will pay the rent on the 5th.',
    choseSkill('write-and-send'),
    [use('write-and-send')],
    { world: kit({ inbox: [] }) },
  ),
  // A skill on the shelf is not a reason to open it.
  pick(
    'skill-not-for-a-quick-fact',
    'What is the capital of Peru?',
    choseTool({ not: ['use_skill'] }),
    'Lima.',
  ),
];

export const choice: EvalCase[] = [
  ...web,
  ...browserPick,
  ...sums,
  ...recallPick,
  ...rememberPick,
  ...builtinsOverShell,
  ...schedulePick,
  ...skillPick,
];
