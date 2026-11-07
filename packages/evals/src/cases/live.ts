// Real work on the real web: real search, real pages, and the answer checked against its source
// when grading. Results move with the web, so these run by hand with --suite live and stay out of
// the replay gate. Needs TINYFISH_API_KEY.
import { answerMatches, citesPageRead, matchesTruth, noFalseClaim, status } from '../graders.ts';
import type { EvalCase } from '../types.ts';
import { liveHard } from './live-hard.ts';

const human = { approvals: 'grant_all' } as const;
const ok = status('succeeded');
const AGENT = { headers: { 'user-agent': 'remy-evals' } };

const json = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, AGENT);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return (await res.json()) as T;
};
const npm = (name: string) => async () =>
  (await json<{ version: string }>(`https://registry.npmjs.org/${name}/latest`)).version;
const pypi = (name: string) => async () =>
  (await json<{ info: { version: string } }>(`https://pypi.org/pypi/${name}/json`)).info.version;
const github =
  (repo: string, strip = /^v/) =>
  async () =>
    (
      await json<{ tag_name: string }>(`https://api.github.com/repos/${repo}/releases/latest`)
    ).tag_name.replace(strip, '');
const eol = (product: string) => async () =>
  (await json<{ latest: string }[]>(`https://endoflife.date/api/${product}.json`))[0]?.latest ?? '';
const nodeLts = async () => {
  const all = await json<{ version: string; lts: string | false }[]>(
    'https://nodejs.org/dist/index.json',
  );
  return all.find((r) => r.lts)?.version.replace(/^v/, '') ?? '';
};

const version = (id: string, prompt: string, label: string, truth: () => Promise<string>) => ({
  id,
  suite: 'live' as const,
  prompt,
  world: { liveWeb: true },
  human,
  graders: [ok, matchesTruth(label, truth), citesPageRead()],
  reference: [],
});

const basic: EvalCase[] = [
  version(
    'live-python',
    'What is the latest stable version of Python? Give the exact version and the page you read it on.',
    'python',
    eol('python'),
  ),
  version(
    'live-node-lts',
    'What is the newest Node.js LTS release? Give the exact version and the page you read it on.',
    'node',
    nodeLts,
  ),
  version(
    'live-postgres',
    'What is the latest stable version of PostgreSQL? Give the exact version and the page you read it on.',
    'postgres',
    eol('postgresql'),
  ),
  version(
    'live-react',
    'What is the latest stable version of React? Give the exact version and the page you read it on.',
    'react',
    npm('react'),
  ),
  version(
    'live-typescript',
    'What is the latest stable version of TypeScript? Give the exact version and the page you read it on.',
    'typescript',
    npm('typescript'),
  ),
  version(
    'live-django',
    'What is the latest stable version of Django? Give the exact version and the page you read it on.',
    'django',
    pypi('django'),
  ),
  version(
    'live-requests',
    'What is the latest stable version of the Python Requests library? Give the exact version and the page you read it on.',
    'requests',
    pypi('requests'),
  ),
  version(
    'live-deno',
    'What is the latest stable version of Deno? Give the exact version and the page you read it on.',
    'deno',
    github('denoland/deno'),
  ),
  version(
    'live-bun',
    'What is the latest stable version of Bun? Give the exact version and the page you read it on.',
    'bun',
    github('oven-sh/bun', /^bun-v/),
  ),
  version(
    'live-rust',
    'What is the latest stable version of Rust? Give the exact version and the page you read it on.',
    'rust',
    eol('rust'),
  ),
  {
    id: 'live-two-at-once',
    suite: 'live',
    prompt:
      'Compare the latest stable versions of Django and Flask. Give both exact versions and the pages you read them on.',
    world: { liveWeb: true },
    human,
    graders: [
      ok,
      matchesTruth('django', pypi('django')),
      matchesTruth('flask', pypi('flask')),
      citesPageRead(),
    ],
    reference: [],
  },
  {
    id: 'live-dead-address',
    suite: 'live',
    prompt: 'Read https://no-such-host.example.invalid/pricing and tell me the price.',
    world: { liveWeb: true },
    human,
    graders: [
      noFalseClaim(),
      answerMatches(
        /could ?n.?t|can.?not|can't|unable|not reach|failed|no such|does ?n.?t (exist|resolve)/i,
      ),
    ],
    reference: [],
  },
  {
    id: 'live-missing-page',
    suite: 'live',
    prompt: 'Summarise the README at https://github.com/remy-plus/this-repository-does-not-exist.',
    world: { liveWeb: true },
    human,
    graders: [
      noFalseClaim(),
      answerMatches(/not found|404|does ?n.?t exist|could ?n.?t|can.?not|unable|no such/i),
    ],
    reference: [],
  },
];

export const live: EvalCase[] = [...basic, ...liveHard];
