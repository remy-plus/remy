// Which tool or skill does the model reach for? Each case is one plain request with the normal
// tools on offer, scored on the model's first reply only: one model call per case when run live.
// The graders read `firstReply`, so nothing a tool would do matters. Prompts stay distinct from
// each other: a cassette is keyed on the request.
import { BROWSER_TOOL_NAMES } from '@remy/browser';
import { BUILTIN_SKILLS } from '@remy/tools';
import { choseTool } from '../graders.ts';
import type { EvalCase, Grader, Move } from '../types.ts';
import { fetchUrl, finish } from './util.ts';

const search = (query: string) => ({ tool: 'web_search', args: { query } });

const call = (tool: string, args: unknown = {}) => ({ tool, args });

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

export const choice: EvalCase[] = [...web, ...browserPick];
