// Real work on the real web: real search, real pages, and the answer checked against its source
// when grading. Results move with the web, so these run by hand with --suite live and stay out of
// the replay gate. Needs TINYFISH_API_KEY.
import { answerMatches, citesPageRead, matchesTruth, noFalseClaim, status } from '../graders.ts';
import type { EvalCase } from '../types.ts';

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

export const live: EvalCase[] = [
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
];
