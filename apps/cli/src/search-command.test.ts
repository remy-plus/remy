import { describe, expect, it } from 'vitest';
import { type KeyRoute, type KeySource, pickSearchRoute, SERVICES } from './search.ts';
import { type SearchCommandContext, searchCommand } from './search-command.ts';

const sources = (over: Partial<Record<KeyRoute, KeySource>> = {}) =>
  ({
    ...Object.fromEntries((Object.keys(SERVICES) as KeyRoute[]).map((k) => [k, 'none'])),
    ...over,
  }) as Record<KeyRoute, KeySource>;

function ctx(over: Partial<SearchCommandContext> = {}) {
  const lines: string[] = [];
  const c: SearchCommandContext = {
    rest: [],
    keyStdin: false,
    env: {},
    platform: 'darwin',
    isTTY: true,
    out: (s) => lines.push(s),
    plan: pickSearchRoute({ keys: { exa: true }, docker: false, vmSetUp: false, browser: false }),
    sources: sources({ exa: 'keychain', tavily: 'env' }),
    ...over,
  };
  return { c, text: () => lines.join('') };
}

describe('remy search', () => {
  it('says which route answers and where each key is', async () => {
    const { c, text } = ctx();
    expect(await searchCommand(c)).toBe(0);
    expect(text()).toContain('Web search uses Exa: the first service with a key.');
    expect(text()).toMatch(/exa\s+Exa\s+key: Keychain/);
    expect(text()).toMatch(/tavily\s+Tavily\s+key: env \(TAVILY_API_KEY\)/);
    expect(text()).toMatch(/serper\s+Serper\s+key: none/);
  });

  it('says why search is off', async () => {
    const { c, text } = ctx({
      plan: pickSearchRoute({ keys: {}, docker: false, vmSetUp: false, browser: false }),
      sources: sources(),
    });
    await searchCommand(c);
    expect(text()).toContain('Search is off: no search key is set');
  });
});

describe('remy search key', () => {
  it('saves a piped key to the Keychain without printing it', async () => {
    const calls: { cmd: string; input?: string | undefined }[] = [];
    const { c, text } = ctx({
      rest: ['key', 'exa'],
      isTTY: false,
      readStdin: async () => 'sk-secret-123\n',
      exec: (cmd, _a, input) => {
        calls.push({ cmd, input });
        return { status: 0, stdout: '' };
      },
    });
    expect(await searchCommand(c)).toBe(0);
    expect(calls[0]?.input).toContain('-a exa -w sk-secret-123');
    expect(text()).not.toContain('sk-secret-123');
    expect(text()).toContain('Saved the Exa key in the Keychain');
  });

  it('asks without echo in a terminal', async () => {
    let asked = '';
    const { c } = ctx({
      rest: ['key', 'serper'],
      askSecret: async (q) => {
        asked = q;
        return 'abc';
      },
      exec: () => ({ status: 0, stdout: '' }),
    });
    expect(await searchCommand(c)).toBe(0);
    expect(asked).toContain('hidden');
  });

  it('points to the environment variable off macOS, and rejects unknown services', async () => {
    const off = ctx({ rest: ['key', 'exa'], platform: 'linux' });
    expect(await searchCommand(off.c)).toBe(1);
    expect(off.text()).toContain('EXA_API_KEY');
    await expect(searchCommand(ctx({ rest: ['key', 'bing'] }).c)).rejects.toThrow('Usage');
  });
});

describe('remy search test', () => {
  const hits = [1, 2, 3, 4].map((n) => ({
    title: `T${n}`,
    url: `https://t${n}.test`,
    snippet: '',
  }));

  it('runs one search on the chosen route and prints the top three with the time', async () => {
    let t = 0;
    const { c, text } = ctx({
      rest: ['test'],
      now: () => (t += 120),
      makeProvider: () => ({ search: async () => hits }),
    });
    expect(await searchCommand(c)).toBe(0);
    expect(text()).toContain('Exa answered in 120 ms');
    expect(text()).toContain('3. T3');
    expect(text()).not.toContain('T4');
  });

  it('names the missing key, and passes a provider error up plainly', async () => {
    await expect(searchCommand(ctx({ rest: ['test', 'linkup'] }).c)).rejects.toThrow(
      'remy search key linkup',
    );
    const { c } = ctx({
      rest: ['test', 'exa'],
      makeProvider: () => ({
        search: async () => {
          throw new Error('Exa refused the key (HTTP 401).');
        },
      }),
    });
    await expect(searchCommand(c)).rejects.toThrow('refused the key');
  });
});

describe('remy search key for readers and cloud browsers', () => {
  it.each([
    ['firecrawl', 'firecrawl'],
    ['cloudflare', 'cloudflare'],
    ['cloudflare-account', 'cloudflare-account'],
    ['steel', 'steel'],
    ['browserbase', 'browserbase'],
    ['browserbase-project', 'browserbase-project'],
  ])('saves %s under its own Keychain account and says what it is for', async (id, account) => {
    const calls: { input?: string | undefined }[] = [];
    const { c, text } = ctx({
      rest: ['key', id],
      isTTY: false,
      readStdin: async () => 'sk-extra-999\n',
      exec: (_cmd, _a, input) => {
        calls.push({ input });
        return { status: 0, stdout: '' };
      },
    });
    expect(await searchCommand(c)).toBe(0);
    expect(calls[0]?.input).toContain(`-a ${account} -w sk-extra-999`);
    expect(text()).not.toContain('sk-extra-999');
    expect(text()).toMatch(/Saved the .* in the Keychain\. It /);
  });

  it('still rejects an unknown id and lists every accepted one', async () => {
    const { c } = ctx({ rest: ['key', 'nope'], isTTY: false });
    await expect(searchCommand(c)).rejects.toThrow(/steel.*browserbase-project|firecrawl/);
  });

  it('prints the reader and browser lines in the status', async () => {
    const { c, text } = ctx({ extra: ['No page reader set.', '', 'Browser: on this computer.'] });
    await searchCommand(c);
    expect(text()).toContain('No page reader set.');
    expect(text()).toContain('Browser: on this computer.');
  });
});
