// Facts read from primary public APIs (no key) when a live case is graded, so a case cannot go
// stale and a model cannot pass from memory. Every helper takes a fetch so tests stub the network.

export type Fetch = typeof fetch;

/** The truth could not be read. The run is not gradable; it says nothing about the model. */
export class TruthError extends Error {}

const AGENT = { headers: { 'user-agent': 'remy-evals' } };
const RETRY_MS = 400;

const get = async (url: string, f: Fetch): Promise<Response> => {
  let last = '';
  for (let i = 0; i < 2; i++) {
    try {
      const res = await f(url, AGENT);
      if (res.status !== 429 && res.status < 500) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String(e);
    }
    if (i === 0) await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  throw new TruthError(`${url} failed: ${last}`);
};

export const getJson = async <T>(url: string, f: Fetch = fetch): Promise<T> => {
  const res = await get(url, f);
  if (!res.ok) throw new TruthError(`${url} returned HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new TruthError(`${url} did not return JSON`);
  }
};

/** True when the address answers 404. Any other answer but 200 is an error, not a yes or no. */
export const isMissing = async (url: string, f: Fetch = fetch): Promise<boolean> => {
  const res = await get(url, f);
  if (res.status === 404) return true;
  if (res.ok) return false;
  throw new TruthError(`${url} returned HTTP ${res.status}`);
};

// ---------- Dates ----------
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const dateOnly = (s: string): string => s.slice(0, 10);

/** Whole days between two dates, ignoring the time of day. */
export const daysBetween = (a: string, b: string): number =>
  Math.round(Math.abs(Date.parse(dateOnly(a)) - Date.parse(dateOnly(b))) / 86_400_000);

/** The ways an answer writes one date: 2028-04-30, 30 April 2028, April 30, 2028, and short months. */
export const dateForms = (iso: string): string[] => {
  const [y, m, d] = dateOnly(iso).split('-').map(Number) as [number, number, number];
  const month = MONTHS[m - 1] ?? '';
  const out = [dateOnly(iso)];
  for (const name of [month, month.slice(0, 3)]) {
    out.push(`${d} ${name} ${y}`, `${name} ${d}, ${y}`, `${name} ${d} ${y}`);
    if (d < 10) out.push(`${name} 0${d}, ${y}`, `0${d} ${name} ${y}`);
  }
  out.push(`${d}th ${month} ${y}`, `${month} ${d}th, ${y}`);
  return [...new Set(out)];
};

/** A day count, give or take one, since a release near midnight lands on either day by zone. */
export const aboutDays = (n: number): string[] => [n, n - 1, n + 1].map(String);

// ---------- Registries ----------
export interface Release {
  version: string;
  /** ISO timestamp the release was published. */
  at: string;
}

export const npmInfo = async (name: string, f: Fetch = fetch) => {
  const doc = await getJson<{ 'dist-tags': { latest: string }; time: Record<string, string> }>(
    `https://registry.npmjs.org/${name}`,
    f,
  );
  const version = doc['dist-tags'].latest;
  const at = doc.time[version];
  if (!at) throw new TruthError(`npm ${name} has no publish time for ${version}`);
  return { version, at } satisfies Release;
};

export const npmLatest = async (name: string, f: Fetch = fetch) =>
  getJson<{
    version: string;
    license?: string;
    dependencies?: Record<string, string>;
  }>(`https://registry.npmjs.org/${name}/latest`, f);

export const pypiInfo = async (name: string, f: Fetch = fetch) => {
  const doc = await getJson<{
    info: { version: string; requires_python?: string | null };
    urls: { upload_time_iso_8601: string }[];
  }>(`https://pypi.org/pypi/${name}/json`, f);
  const at = doc.urls.map((u) => u.upload_time_iso_8601).sort()[0];
  if (!at) throw new TruthError(`PyPI ${name} has no files for ${doc.info.version}`);
  return {
    version: doc.info.version,
    at,
    requiresPython: doc.info.requires_python ?? '',
  };
};

export const cratesInfo = async (name: string, f: Fetch = fetch) => {
  const doc = await getJson<{
    crate: { max_stable_version: string };
    versions: { num: string; created_at: string }[];
  }>(`https://crates.io/api/v1/crates/${name}`, f);
  const version = doc.crate.max_stable_version;
  const at = doc.versions.find((v) => v.num === version)?.created_at;
  if (!at) throw new TruthError(`crates.io ${name} has no record of ${version}`);
  return { version, at } satisfies Release;
};

export interface Cycle {
  cycle: string;
  releaseDate: string;
  eol: string | boolean;
  latest: string;
  latestReleaseDate?: string;
  lts?: string | boolean;
  codename?: string;
}

export const eolCycles = (product: string, f: Fetch = fetch) =>
  getJson<Cycle[]>(`https://endoflife.date/api/${product}.json`, f);

export interface NodeRelease {
  version: string;
  date: string;
  lts: string | false;
}

export const nodeIndex = (f: Fetch = fetch) =>
  getJson<NodeRelease[]>('https://nodejs.org/dist/index.json', f);

export interface NodeLine {
  start: string;
  lts?: string;
  end: string;
  codename?: string;
}

export const nodeSchedule = (f: Fetch = fetch) =>
  getJson<Record<string, NodeLine>>(
    'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json',
    f,
  );

/** The newest LTS line: its major, the line's dates and the newest release in it. */
export const nodeLtsLine = async (f: Fetch = fetch) => {
  const [index, schedule] = await Promise.all([nodeIndex(f), nodeSchedule(f)]);
  const first = index.find((r) => r.lts);
  if (!first) throw new TruthError('nodejs.org lists no LTS release');
  const major = first.version.replace(/^v/, '').split('.')[0] ?? '';
  const line = schedule[`v${major}`];
  if (!line) throw new TruthError(`the Node.js schedule has no v${major}`);
  return { major, line, newest: first };
};
