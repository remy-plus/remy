/**
 * Measures Remy's browser on Chrome and on Lightpanda. Not part of the build or the tests.
 *
 *   node --conditions=@remy/source packages/browser/bench/measure.ts [--runs 3] [--out file.json]
 *
 * Each run of each engine happens in its own child process, so the browser's memory is the sum of
 * that child's descendants and nothing else. Per run: cold start (first page read, including
 * launching and connecting), time to open and read every page, peak resident memory of the browser
 * processes (sampled every 100 ms), and whether Remy's own page reader (the snapshot the tools
 * use) returns usable text and controls. Medians over the runs are printed as JSON and a table.
 * Needs the network for the public pages.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightpandaProvider, createLocalBrowser, resolveEngine } from '../src/index.ts';

interface Page {
  name: string;
  url: string;
  /** Text the page must give back for the read to count as usable. */
  expect: RegExp;
  /** At least this many controls (links, buttons, fields). */
  controls?: number;
}

const REAL: Page[] = [
  { name: 'example.com', url: 'https://example.com/', expect: /Example Domain/ },
  {
    name: 'wikipedia article',
    url: 'https://en.wikipedia.org/wiki/Web_browser',
    expect: /web browser/i,
    controls: 20,
  },
  {
    name: 'news.ycombinator.com',
    url: 'https://news.ycombinator.com/',
    expect: /Hacker News/,
    controls: 20,
  },
  {
    name: 'docs.python.org json',
    url: 'https://docs.python.org/3/library/json.html',
    expect: /json\.dumps/,
    controls: 20,
  },
  {
    name: 'github repo page',
    url: 'https://github.com/microsoft/playwright',
    expect: /playwright/i,
    controls: 20,
  },
];

const FIXTURE_HTML: Record<string, string> = {
  '/': `<title>Fixture home</title><h1>Fixture home</h1><p>${'A plain paragraph of readable text. '.repeat(20)}</p><a href="/form">Form</a> <a href="/js">Script page</a>`,
  '/article': `<title>Article</title><article><h1>Quiet browsers</h1>${'<p>Pages are read as text, in order, with the links kept.</p>'.repeat(40)}</article>`,
  '/form': `<title>Form</title><h1>Contact</h1><form method="get" action="/thanks"><label>Name <input name="name" type="text"></label><label>Note <input name="note" type="text"></label><button type="submit">Send</button></form>`,
  '/thanks': `<title>Thanks</title><h1>Thanks, received</h1>`,
  '/js': `<title>Script page</title><div id="app">loading</div><script>document.getElementById('app').innerHTML='<h1>Rendered by script</h1><p>This text only exists after the script runs.</p>'</script>`,
  '/table': `<title>Table</title><table>${'<tr><td>Item</td><td>42</td></tr>'.repeat(60)}</table>`,
};

function startFixtureServer(): Promise<{ origin: string; stop: () => void }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const html = FIXTURE_HTML[path];
      res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">${html ?? 'not found'}`);
    });
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      resolve({ origin: `http://127.0.0.1:${port}`, stop: () => srv.close() });
    });
  });
}

/** Resident memory (KB) of every descendant of this process, from `ps`. */
function descendantsRssKb(): number {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  const rows = out
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number) as [number, number, number]);
  const kids = new Map<number, number[]>();
  for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0;
  const stack = [...(kids.get(process.pid) ?? [])];
  while (stack.length) {
    const pid = stack.pop() as number;
    total += rss.get(pid) ?? 0;
    stack.push(...(kids.get(pid) ?? []));
  }
  return total;
}

interface PageResult {
  name: string;
  ms: number;
  ok: boolean;
  chars: number;
  controls: number;
  why?: string;
}

interface RunResult {
  engine: string;
  coldStartMs: number;
  fixtureMs: number;
  realMs: number;
  peakRssMb: number;
  pages: PageResult[];
  interaction: { ok: boolean; why?: string };
}

async function worker(engine: 'chrome' | 'lightpanda'): Promise<RunResult> {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), 'remy-bench-'));
  let peak = 0;
  const sampler = setInterval(() => {
    try {
      peak = Math.max(peak, descendantsRssKb());
    } catch {}
  }, 100);
  let remote: ReturnType<typeof createLightpandaProvider> | undefined;
  if (engine === 'lightpanda') {
    const choice = resolveEngine({ REMY_BROWSER_ENGINE: 'lightpanda' });
    if (choice.kind !== 'lightpanda') throw new Error('Lightpanda is not installed');
    remote = createLightpandaProvider({ binary: choice.path, allowLocal: true });
  }
  const browser = createLocalBrowser({
    profileDir,
    allowLocal: true,
    navigationTimeoutMs: 30_000,
    ...(remote && { remote }),
  });

  const read = async (p: Page): Promise<PageResult> => {
    const t0 = performance.now();
    try {
      const s = await browser.open(p.url);
      const ms = performance.now() - t0;
      const ok = p.expect.test(`${s.title} ${s.text}`) && s.elements.length >= (p.controls ?? 0);
      return {
        name: p.name,
        ms,
        ok,
        chars: s.text.length,
        controls: s.elements.length,
        ...(ok
          ? {}
          : {
              why: p.expect.test(`${s.title} ${s.text}`)
                ? `only ${s.elements.length} controls`
                : `expected text missing (${s.text.length} chars read)`,
            }),
      };
    } catch (e) {
      const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
      return { name: p.name, ms: performance.now() - t0, ok: false, chars: 0, controls: 0, why };
    }
  };

  const local: Page[] = [
    { name: 'fixture home', url: `${fixture.origin}/`, expect: /Fixture home/, controls: 2 },
    { name: 'fixture article', url: `${fixture.origin}/article`, expect: /Quiet browsers/ },
    { name: 'fixture form', url: `${fixture.origin}/form`, expect: /Contact/, controls: 3 },
    { name: 'fixture script-rendered', url: `${fixture.origin}/js`, expect: /Rendered by script/ },
    { name: 'fixture table', url: `${fixture.origin}/table`, expect: /Item 42/ },
  ];

  const pages: PageResult[] = [];
  let coldStartMs = 0;
  let fixtureMs = 0;
  let realMs = 0;
  const interaction: RunResult['interaction'] = { ok: false };
  try {
    for (const [i, p] of local.entries()) {
      const r = await read(p);
      if (i === 0) coldStartMs = r.ms;
      else fixtureMs += r.ms;
      pages.push(r);
    }
    // Interaction on the form: type into a field, press the button, land on the next page.
    try {
      const s = await browser.open(`${fixture.origin}/form`);
      const field = s.elements.find((e) => e.kind === 'textbox');
      const send = s.elements.find((e) => e.kind === 'submit' || e.kind === 'button');
      if (!field || !send) throw new Error('form controls not found');
      await browser.type(field.ref, 'Remy', false);
      const after = await browser.click(send.ref);
      interaction.ok = /Thanks, received/.test(after.text) && /name=Remy/.test(after.url);
      if (!interaction.ok) interaction.why = `ended on ${after.url}`;
    } catch (e) {
      interaction.why = e instanceof Error ? e.message.split('\n')[0] : String(e);
    }
    for (const p of REAL) {
      const r = await read(p);
      realMs += r.ms;
      pages.push(r);
    }
  } finally {
    await browser.close().catch(() => {});
    clearInterval(sampler);
    fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
  return {
    engine,
    coldStartMs,
    fixtureMs,
    realMs,
    peakRssMb: peak / 1024,
    pages,
    interaction,
  };
}

interface RawResult {
  engine: string;
  /** Launch (or start the engine) and connect, until a blank tab exists. */
  engineStartMs: number;
  /** goto (domcontentloaded) of the 4 fixture pages after the first, no settling, no reader. */
  rawFixtureMs: number;
  rawRealMs: number;
  peakRssMb: number;
}

/**
 * The engine alone, straight through Playwright: no 500 ms network-idle wait, no page reader. The
 * Remy numbers above are dominated by that wait, which hides the difference between engines.
 */
async function rawWorker(engine: 'chrome' | 'lightpanda'): Promise<RawResult> {
  const fixture = await startFixtureServer();
  let peak = 0;
  const sampler = setInterval(() => {
    try {
      peak = Math.max(peak, descendantsRssKb());
    } catch {}
  }, 100);
  const { chromium } = await import('playwright-core'); // loaded before the clock starts
  const t0 = performance.now();
  let close = async () => {};
  let page: import('playwright-core').Page;
  if (engine === 'lightpanda') {
    const choice = resolveEngine({ REMY_BROWSER_ENGINE: 'lightpanda' });
    if (choice.kind !== 'lightpanda') throw new Error('Lightpanda is not installed');
    const session = await createLightpandaProvider({
      binary: choice.path,
      allowLocal: true,
    }).createSession();
    const b = await chromium.connectOverCDP(session.cdpUrl);
    const c = b.contexts()[0] ?? (await b.newContext());
    page = await c.newPage();
    close = async () => {
      await b.close().catch(() => {});
      await session.close();
    };
  } else {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    page = await (await b.newContext()).newPage();
    close = () => b.close();
  }
  const engineStartMs = performance.now() - t0;
  const go = async (urls: string[]) => {
    const t = performance.now();
    for (const u of urls) await page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});
    return performance.now() - t;
  };
  const rawFixtureMs = await go(
    ['/article', '/form', '/js', '/table'].map((p) => `${fixture.origin}${p}`),
  );
  const rawRealMs = await go(REAL.map((p) => p.url));
  await close();
  clearInterval(sampler);
  fixture.stop();
  return { engine, engineStartMs, rawFixtureMs, rawRealMs, peakRssMb: peak / 1024 };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

function runWorker<T = RunResult>(engine: string, mode = '--worker'): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--conditions=@remy/source', process.argv[1] as string, mode, engine],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    child.stdout.on('data', (c) => {
      out += String(c);
    });
    child.on('exit', (code) => {
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() ?? '') as T);
      } catch {
        reject(new Error(`${engine} worker exited ${code} without a result`));
      }
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wi = args.indexOf('--worker');
  if (wi >= 0) {
    const r = await worker(args[wi + 1] as 'chrome' | 'lightpanda');
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exit(0);
  }
  const ri = args.indexOf('--raw');
  if (ri >= 0) {
    const r = await rawWorker(args[ri + 1] as 'chrome' | 'lightpanda');
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exit(0);
  }
  const runs = Number(args[args.indexOf('--runs') + 1]) || 3;
  const out = args.includes('--out') ? (args[args.indexOf('--out') + 1] as string) : undefined;
  const all: Record<string, RunResult[]> = { chrome: [], lightpanda: [] };
  for (let i = 0; i < runs; i++) {
    for (const engine of ['chrome', 'lightpanda']) {
      process.stderr.write(`run ${i + 1}/${runs}: ${engine}\n`);
      (all[engine] as RunResult[]).push(await runWorker(engine));
    }
  }
  const summary = Object.fromEntries(
    Object.entries(all).map(([engine, rs]) => {
      const names = (rs[0] as RunResult).pages.map((p) => p.name);
      return [
        engine,
        {
          coldStartMs: Math.round(median(rs.map((r) => r.coldStartMs))),
          fixtureMsFor4Pages: Math.round(median(rs.map((r) => r.fixtureMs))),
          realMsFor5Pages: Math.round(median(rs.map((r) => r.realMs))),
          peakRssMb: Math.round(median(rs.map((r) => r.peakRssMb))),
          interactionOk: rs.filter((r) => r.interaction.ok).length,
          pages: names.map((name) => {
            const ps = rs.map((r) => r.pages.find((p) => p.name === name) as PageResult);
            return {
              name,
              medianMs: Math.round(median(ps.map((p) => p.ms))),
              usable: ps.filter((p) => p.ok).length,
              chars: Math.round(median(ps.map((p) => p.chars))),
              controls: Math.round(median(ps.map((p) => p.controls))),
              why: ps.find((p) => p.why)?.why,
            };
          }),
          interactionWhy: rs.find((r) => r.interaction.why)?.interaction.why,
        },
      ];
    }),
  );
  const rawAll: Record<string, RawResult[]> = { chrome: [], lightpanda: [] };
  for (let i = 0; i < runs; i++)
    for (const engine of ['chrome', 'lightpanda']) {
      process.stderr.write(`raw run ${i + 1}/${runs}: ${engine}\n`);
      (rawAll[engine] as RawResult[]).push(await runWorker<RawResult>(engine, '--raw'));
    }
  const raw = Object.fromEntries(
    Object.entries(rawAll).map(([engine, rs]) => [
      engine,
      {
        engineStartMs: Math.round(median(rs.map((r) => r.engineStartMs))),
        rawFixtureMsFor4Pages: Math.round(median(rs.map((r) => r.rawFixtureMs))),
        rawRealMsFor5Pages: Math.round(median(rs.map((r) => r.rawRealMs))),
        peakRssMb: Math.round(median(rs.map((r) => r.peakRssMb))),
      },
    ]),
  );
  const json = JSON.stringify({ runs, summary, raw, all, rawAll }, null, 2);
  if (out) writeFileSync(out, json);
  process.stdout.write(`${JSON.stringify({ runs, summary, raw }, null, 2)}\n`);
}

await main();
