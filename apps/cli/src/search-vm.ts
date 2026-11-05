// Search in a real Chromium with a virtual display, inside a container. Search engines turn away a
// browser with no display, and a window on the user's screen is not wanted, so the display lives
// in the container. It holds no cookies or files of the user's: nothing is mounted, and the port
// is open to this machine only and needs a token.
import {
  BING_RESULTS_SCRIPT,
  DDG_RESULTS_SCRIPT,
  firstUseful,
  type SearchHit,
} from '@remy/browser';
import type { SearchProvider } from '@remy/tools';

const NAME = 'remy-search';
const IMAGE = 'mcr.microsoft.com/playwright:v1.50.0-noble';
const INNER_PORT = 8080;
export const VM_PORT = 38917;
/** A search takes a few seconds, and two engines may be tried. */
export const VM_TIMEOUT_MS = 45_000;

const NOT_RUNNING = 'Search in the container is not running. Start it with remy browser vm start.';

export interface VmConnection {
  url: string;
  token: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** `REMY_SEARCH=vm`: asks the container, DuckDuckGo first, and keeps only useful hits. */
export function vmSearch(
  conn: VmConnection | (() => VmConnection),
  fetchImpl: Fetch = fetch,
  /** Starts the container when it is not running. False when it could not. */
  ensure?: () => Promise<boolean>,
): SearchProvider {
  const current = () => (typeof conn === 'function' ? conn() : conn);
  const ask = (name: string, query: string) => {
    const { url, token } = current();
    return fetchImpl(`${url}/search?engine=${name}&q=${encodeURIComponent(query)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  };
  const engine = (name: string, query: string) => async (): Promise<SearchHit[] | null> => {
    let r: Response;
    try {
      r = await ask(name, query);
    } catch {
      if (!(await ensure?.())) throw new Error(NOT_RUNNING);
      r = await ask(name, query).catch(() => {
        throw new Error(NOT_RUNNING);
      });
    }
    if (!r.ok) throw new Error(`Search in the container failed (${r.status}).`);
    return ((await r.json()) as { hits: SearchHit[] | null }).hits;
  };
  return {
    async search(query, count) {
      const hits = await firstUseful(query, [engine('ddg', query), engine('bing', query)]);
      return hits.slice(0, count);
    },
  };
}

/** What runs in the container: one search at a time, with a pause between them. */
export function vmServerScript(): string {
  return `
const http = require('node:http');
const { chromium } = require('playwright');
const ENGINES = {
  ddg: [(q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), ${JSON.stringify(DDG_RESULTS_SCRIPT)}],
  bing: [(q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q), ${JSON.stringify(BING_RESULTS_SCRIPT)}],
};
const TOKEN = process.env.REMY_SEARCH_TOKEN;
let queue = Promise.resolve();
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'en-US' });
  const search = async (name, q) => {
    const [url, script] = ENGINES[name];
    const page = await context.newPage();
    try {
      await page.goto(url(q), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
      return await page.evaluate(script);
    } finally {
      await page.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {});
    if (u.pathname === '/health') return send(200, { ok: true });
    const name = u.searchParams.get('engine');
    const q = u.searchParams.get('q');
    if (u.pathname !== '/search' || !ENGINES[name] || !q) return send(400, {});
    const job = queue.then(() => search(name, q));
    queue = job.catch(() => {});
    job.then((hits) => send(200, { hits }), (e) => send(502, { error: String(e.message) }));
  }).listen(${INNER_PORT}, '0.0.0.0');
})();
`;
}

export interface VmOptions {
  port: number;
  token: string;
  script: string;
}

export function dockerRunArgs(o: VmOptions): string[] {
  return [
    'run',
    '-d',
    '--rm',
    '--init',
    '--name',
    NAME,
    '--memory',
    '2g',
    '--security-opt',
    'no-new-privileges',
    '-p',
    `127.0.0.1:${o.port}:${INNER_PORT}`,
    '-e',
    `REMY_SEARCH_TOKEN=${o.token}`,
    '-e',
    `REMY_SEARCH_SERVER=${o.script}`,
    IMAGE,
    'bash',
    '-c',
    'mkdir -p /w && cd /w && npm i --silent playwright@1.50.0 && xvfb-run -a node -e "$REMY_SEARCH_SERVER"',
  ];
}

export type Run = (cmd: string, args: string[]) => { ok: boolean; out: string };

export type VmStatus = 'running' | 'stopped' | 'no-docker';

export function vmStatus(run: Run): VmStatus {
  if (!run('docker', ['info']).ok) return 'no-docker';
  const ps = run('docker', ['ps', '--filter', `name=^${NAME}$`, '--format', '{{.Names}}']);
  return ps.out.trim() === NAME ? 'running' : 'stopped';
}

/** Starts Colima when Docker is not up and Colima is there; asks for nothing else. */
export function startVm(
  run: Run,
  o: VmOptions,
): 'started' | 'already-running' | 'no-docker' | 'failed' {
  let status = vmStatus(run);
  if (status === 'no-docker' && run('colima', ['start']).ok) status = vmStatus(run);
  if (status === 'no-docker') return 'no-docker';
  if (status === 'running') return 'already-running';
  return run('docker', dockerRunArgs(o)).ok ? 'started' : 'failed';
}

export function stopVm(run: Run): void {
  run('docker', ['stop', NAME]);
}

/** Waits for the container to answer. The first start downloads a browser image. */
export async function waitForVm(
  conn: VmConnection,
  fetchImpl: Fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  tries = 300,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(`${conn.url}/health`, {
        headers: { authorization: `Bearer ${conn.token}` },
      });
      if (r.ok) return true;
    } catch {}
    await sleep(1_000);
  }
  return false;
}
