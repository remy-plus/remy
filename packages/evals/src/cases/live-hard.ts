// Harder real work on the live web, run by hand with --suite live-hard (or as part of --suite live).
// Each case needs several steps a cheap model gets wrong in ways a real user meets: a number to
// compute, an answer that depends on the one before it, a fact the first search hits have stale, a
// reply with several parts that all must be right, or a thing that does not exist. Every answer is
// checked at grade time against a primary public API, so none can go stale or pass from memory.
import { citesPageRead, matchesAll, noFalseClaim, saysMissing, status } from '../graders.ts';
import {
  aboutDays,
  cratesInfo,
  dateForms,
  daysBetween,
  eolCycles,
  isMissing,
  nodeIndex,
  nodeLtsLine,
  npmInfo,
  npmLatest,
  pypiInfo,
  TruthError,
} from '../truth.ts';
import type { EvalCase } from '../types.ts';

const human = { approvals: 'grant_all' } as const;
const ok = status('succeeded');

/** A multi-part case: the answer must carry every part the source holds. */
const parts = (
  id: string,
  prompt: string,
  label: string,
  truth: Parameters<typeof matchesAll>[1],
): EvalCase => ({
  id: `live-hard-${id}`,
  suite: 'live',
  prompt,
  world: { liveWeb: true },
  human,
  graders: [ok, matchesAll(label, truth), citesPageRead()],
  reference: [],
});

const missing = (
  id: string,
  prompt: string,
  label: string,
  confirm: () => Promise<boolean>,
  echo: string[] = [],
  real?: () => Promise<string[]>,
): EvalCase => ({
  id: `live-hard-${id}`,
  suite: 'live',
  prompt,
  world: { liveWeb: true },
  human,
  graders: [noFalseClaim(), saysMissing(label, confirm, echo, real)],
  reference: [],
});

interface Dated {
  name: string;
  version: string;
  at: string;
}

/** Newest first; the parts every "which is newer" case asks for. */
const raceParts = (all: Dated[]) => {
  const sorted = [...all].sort((a, b) => b.at.localeCompare(a.at));
  const newest = sorted[0] as Dated;
  const oldest = sorted[sorted.length - 1] as Dated;
  return [
    { name: 'newest', accept: [`Newer: ${newest.name}`] },
    ...all.map((d) => ({ name: `${d.name} version`, accept: [d.version] })),
    {
      name: 'days apart',
      accept: aboutDays(daysBetween(newest.at, oldest.at)),
    },
  ];
};

const today = () => new Date().toISOString().slice(0, 10);
/** The newest cycle already out, matching a test, since endoflife.date also lists coming ones. */
const newestCycle = async (product: string, pick: (c: { lts?: string | boolean }) => boolean) => {
  const found = (await eolCycles(product)).find((c) => c.releaseDate <= today() && pick(c));
  if (!found) throw new TruthError(`endoflife.date lists no matching ${product} cycle`);
  return found;
};
const dateOf = (c: { eol: string | boolean }) => {
  if (typeof c.eol !== 'string') throw new TruthError('the end-of-life date is not set yet');
  return c.eol;
};

const RACE =
  'Give each latest stable version, say which was published most recently and how many days earlier the oldest one was published. End with one line "Newer: <name>".';
const NPM = ['chalk', 'picocolors', 'kleur'];
const NO_PKG = 'remy-evals-lockstep-widgets-x9';

export const liveHard: EvalCase[] = [
  // Compare and compute.
  parts('npm-newest', `Of the npm packages ${NPM.join(', ')}: ${RACE}`, 'npm race', async () =>
    raceParts(await Promise.all(NPM.map(async (name) => ({ name, ...(await npmInfo(name)) })))),
  ),
  parts('pypi-newest', `Of the PyPI packages flask and requests: ${RACE}`, 'pypi race', async () =>
    raceParts(
      await Promise.all(
        ['flask', 'requests'].map(async (name) => ({ name, ...(await pypiInfo(name)) })),
      ),
    ),
  ),
  parts(
    'crates-newest',
    `Of the Rust crates serde and rand on crates.io: ${RACE}`,
    'crates race',
    async () =>
      raceParts(
        await Promise.all(
          ['serde', 'rand'].map(async (name) => ({ name, ...(await cratesInfo(name)) })),
        ),
      ),
  ),
  parts(
    'python-support-span',
    'Take the newest stable Python feature release (such as 3.x, not a patch). Give its version, the date it was first released, the date it reaches end of life, and how many days that span is.',
    'python span',
    async () => {
      const c = await newestCycle('python', () => true);
      const eol = dateOf(c);
      return [
        { name: 'cycle', accept: [c.cycle] },
        { name: 'release date', accept: dateForms(c.releaseDate) },
        { name: 'end of life', accept: dateForms(eol) },
        { name: 'days', accept: aboutDays(daysBetween(c.releaseDate, eol)) },
      ];
    },
  ),

  // Chains: the first answer decides the second step.
  parts(
    'node-lts-line',
    'Find the newest Node.js LTS line. Give its major version, its codename, the date its support ends (end of life), and the newest release number in that line.',
    'node lts line',
    async () => {
      const { major, line, newest } = await nodeLtsLine();
      return [
        { name: 'major', accept: [`v${major}`, `Node ${major}`, `Node.js ${major}`, `${major}.x`] },
        { name: 'codename', accept: [line.codename ?? ''] },
        { name: 'end of life', accept: dateForms(line.end) },
        { name: 'newest release', accept: [newest.version.replace(/^v/, '')] },
      ];
    },
  ),
  parts(
    'node-lts-days',
    'Find the newest Node.js LTS line. How many days is it supported from the day it became LTS to its end of life? Give the line, both dates and the number of days.',
    'node lts days',
    async () => {
      const { major, line } = await nodeLtsLine();
      if (!line.lts) throw new TruthError(`the schedule has no LTS date for v${major}`);
      return [
        { name: 'major', accept: [`v${major}`, `Node ${major}`, `Node.js ${major}`, `${major}.x`] },
        { name: 'LTS date', accept: dateForms(line.lts) },
        { name: 'end of life', accept: dateForms(line.end) },
        { name: 'days', accept: aboutDays(daysBetween(line.lts, line.end)) },
      ];
    },
  ),
  parts(
    'django-lts',
    'Find the newest Django long-term-support release series that is already out. Give the series, its newest patch version, and the date its support ends.',
    'django lts',
    async () => {
      const c = await newestCycle('django', (x) => !!x.lts);
      return [
        { name: 'series', accept: [c.cycle] },
        { name: 'patch', accept: [c.latest] },
        { name: 'end of support', accept: dateForms(dateOf(c)) },
      ];
    },
  ),
  parts(
    'ubuntu-lts',
    'Find the newest Ubuntu LTS that is already released. Give its version number, its codename, and the date its standard support ends.',
    'ubuntu lts',
    async () => {
      const c = await newestCycle('ubuntu', (x) => !!x.lts);
      return [
        { name: 'version', accept: [c.cycle] },
        { name: 'codename', accept: [c.codename ?? '', (c.codename ?? '').split(' ')[0] ?? ''] },
        { name: 'end of support', accept: dateForms(dateOf(c)) },
      ];
    },
  ),

  // Conflict: older pages and early search hits say something else.
  parts(
    'rust-current',
    'What is the current stable Rust release, and on what date was it published?',
    'rust current',
    async () => {
      const c = await newestCycle('rust', () => true);
      if (!c.latestReleaseDate) throw new TruthError('no release date for the newest Rust');
      return [
        { name: 'version', accept: [c.latest] },
        { name: 'date', accept: dateForms(c.latestReleaseDate) },
      ];
    },
  ),

  // Several parts read off one package page; all must be right.
  parts(
    'vitest-facts',
    'For the latest version of the npm package vitest, give the version number, its license, and how many direct dependencies it lists (not dev or peer).',
    'vitest facts',
    async () => {
      const p = await npmLatest('vitest');
      return [
        { name: 'version', accept: [p.version] },
        { name: 'license', accept: [p.license ?? ''] },
        {
          name: 'dependency count',
          accept: [String(Object.keys(p.dependencies ?? {}).length)],
        },
      ];
    },
  ),
  parts(
    'httpx-facts',
    'For the latest release of the Python package httpx, give the version, the Python versions it requires, and the date it was uploaded.',
    'httpx facts',
    async () => {
      const p = await pypiInfo('httpx');
      return [
        { name: 'version', accept: [p.version] },
        { name: 'requires python', accept: [p.requiresPython] },
        { name: 'upload date', accept: dateForms(p.at) },
      ];
    },
  ),

  // Not there: say so, do not invent.
  missing(
    'missing-npm',
    `What is the latest version of the npm package ${NO_PKG}, and what does it do?`,
    NO_PKG,
    () => isMissing(`https://registry.npmjs.org/${NO_PKG}`),
  ),
  missing(
    'missing-pypi',
    `Which Python version does the PyPI package ${NO_PKG} require, and who maintains it?`,
    NO_PKG,
    () => isMissing(`https://pypi.org/pypi/${NO_PKG}/json`),
  ),
  missing(
    'missing-node-release',
    'Summarise the release notes of Node.js v99.0.0 and give its release date.',
    'Node.js v99.0.0',
    async () => !(await nodeIndex()).some((r) => r.version === 'v99.0.0'),
    ['v99.0.0', '99.0.0'],
    async () => (await nodeIndex()).map((r) => r.version),
  ),
];
