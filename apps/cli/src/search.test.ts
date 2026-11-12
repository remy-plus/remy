import { type SearchProvider, SearchUnavailable } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import {
  gatherSearchPlan,
  makeService,
  noRouteMessage,
  pickSearchRoute,
  type Route,
  resolveSearchKeys,
  routedSearch,
  type SearchFacts,
} from './search.ts';

const none: SearchFacts = { keys: {}, docker: false, vmSetUp: false, browser: false };
const hit = { title: 'T', url: 'https://a.test', snippet: 's' };
const answers: SearchProvider = { search: async () => [hit] };
const unavailable = (msg: string): SearchProvider => ({
  search: async () => {
    throw new SearchUnavailable(msg);
  },
});

describe('pickSearchRoute', () => {
  it('puts a key route first, in the order Exa, TinyFish, Perplexity, Tavily, Linkup, Serper, Brave, Context.dev, SearXNG', () => {
    const all = {
      exa: true,
      tinyfish: true,
      perplexity: true,
      tavily: true,
      linkup: true,
      serper: true,
      brave: true,
      context: true,
      searxng: true,
    };
    const plan = pickSearchRoute({
      ...none,
      keys: all,
      docker: true,
      vmSetUp: true,
      browser: true,
    });
    expect(plan.order).toEqual([
      'exa',
      'tinyfish',
      'perplexity',
      'tavily',
      'linkup',
      'serper',
      'brave',
      'context',
      'searxng',
      'vm',
      'browser',
    ]);
    expect(plan.chosen).toBe('exa');
    expect(plan.step).toBeUndefined();
    expect(pickSearchRoute({ ...none, keys: { context: true, brave: true } }).chosen).toBe('brave');
  });

  it('uses the container when Docker runs and it is set up, else the hidden browser', () => {
    const base = { ...none, browser: true };
    expect(pickSearchRoute({ ...base, docker: true, vmSetUp: true }).order).toEqual([
      'vm',
      'browser',
    ]);
    expect(pickSearchRoute({ ...base, docker: false, vmSetUp: true }).order).toEqual(['browser']);
    expect(pickSearchRoute({ ...base, docker: true }).order).toEqual(['browser']);
  });

  it('names one step to improve a browser-only machine', () => {
    const plan = pickSearchRoute({ ...none, browser: true });
    expect(plan.chosen).toBe('browser');
    expect(plan.step).toContain('TINYFISH_API_KEY');
    const docker = pickSearchRoute({ ...none, browser: true, docker: true });
    expect(docker.step).toContain('remy browser vm start');
  });

  it('has no route with nothing set up, and says why and what to do', () => {
    const plan = pickSearchRoute(none);
    expect(plan).toMatchObject({ order: [], off: false });
    expect(plan.chosen).toBeUndefined();
    expect(plan.why).toContain('Docker is not running');
    expect(plan.step).toBe('Get a free TinyFish key and set TINYFISH_API_KEY.');
  });

  it('lets REMY_SEARCH override, and keeps to that route alone', () => {
    const rich = { ...none, keys: { tinyfish: true, brave: true }, browser: true };
    expect(pickSearchRoute({ ...rich, override: 'brave' }).order).toEqual(['brave']);
    expect(pickSearchRoute({ ...rich, override: 'Browser' }).order).toEqual(['browser']);
    expect(pickSearchRoute({ ...rich, override: 'vm' }).order).toEqual(['vm']);
    expect(pickSearchRoute({ ...rich, override: 'off' })).toMatchObject({ order: [], off: true });
  });

  it('explains a pick that cannot work', () => {
    const missing = pickSearchRoute({ ...none, override: 'context' });
    expect(missing.order).toEqual([]);
    expect(missing.step).toContain('CONTEXT_DEV_API_KEY');
    const bad = pickSearchRoute({ ...none, override: 'google' });
    expect(bad.order).toEqual([]);
    expect(bad.step).toContain('browser, vm, context');
    expect(pickSearchRoute({ ...none, override: 'exa' }).step).toContain('remy search key exa');
  });
});

describe('gatherSearchPlan', () => {
  const base = { override: undefined, vmSetUp: false, browser: true };

  it('reads keys from the environment and does not probe Docker when a key settles it', () => {
    let probes = 0;
    const hasDocker = () => {
      probes++;
      return true;
    };
    const plan = gatherSearchPlan({ ...base, env: { TINYFISH_API_KEY: 'k' }, hasDocker });
    expect(plan.chosen).toBe('tinyfish');
    gatherSearchPlan({ ...base, override: 'browser', env: {}, hasDocker });
    expect(probes).toBe(0);
    gatherSearchPlan({ ...base, env: {}, hasDocker });
    expect(probes).toBe(1);
  });
});

describe('routedSearch', () => {
  const plan = (order: Route[]) => ({ order, chosen: order[0], override: false, off: false });

  it('says which route answered', async () => {
    const { provider } = routedSearch(plan(['tinyfish', 'browser']), () => answers);
    expect(await provider.search('rye', 5)).toEqual([{ ...hit, via: 'TinyFish' }]);
  });

  it('tries the next route once when the first cannot recover', async () => {
    const calls: Route[] = [];
    const { provider } = routedSearch(plan(['tinyfish', 'vm', 'browser']), (r) => {
      calls.push(r);
      return r === 'browser' ? answers : unavailable(`${r} is gone.`);
    });
    const out = await provider.search('rye', 5);
    expect(out[0]?.via).toBe('the hidden browser');
    expect(calls).toEqual(['tinyfish', 'vm', 'browser']);
  });

  it('remembers the failure and skips that route on later searches', async () => {
    let tinyfishCalls = 0;
    const { provider, dead } = routedSearch(plan(['tinyfish', 'browser']), (r) =>
      r === 'tinyfish'
        ? {
            search: async () => {
              tinyfishCalls++;
              throw new SearchUnavailable('TinyFish refused the key (HTTP 401).');
            },
          }
        : answers,
    );
    await provider.search('one', 5);
    await provider.search('two', 5);
    await provider.search('three', 5);
    expect(tinyfishCalls).toBe(1);
    expect(dead.get('tinyfish')).toContain('refused the key');
  });

  it('does not move on from a passing failure', async () => {
    let browserCalls = 0;
    const { provider, dead } = routedSearch(plan(['tinyfish', 'browser']), (r) =>
      r === 'tinyfish'
        ? {
            search: async () => {
              throw new Error('TinyFish returned HTTP 503');
            },
          }
        : {
            search: async () => {
              browserCalls++;
              return [hit];
            },
          },
    );
    await expect(provider.search('rye', 5)).rejects.toThrow('HTTP 503');
    expect(browserCalls).toBe(0);
    expect(dead.size).toBe(0);
  });

  it('treats a bot check as a dead route and never retries it', async () => {
    let tries = 0;
    const { provider } = routedSearch(plan(['browser']), () => ({
      search: async () => {
        tries++;
        throw new SearchUnavailable('The search engine showed a bot check, so this route is off.');
      },
    }));
    await expect(provider.search('a', 5)).rejects.toThrow('bot check');
    await expect(provider.search('b', 5)).rejects.toThrow('Web search is off');
    expect(tries).toBe(1);
  });

  it('answers with a short plain error naming the one step when no route works', async () => {
    const empty = routedSearch(pickSearchRoute(none), () => answers);
    const err = await empty.provider.search('rye', 5).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SearchUnavailable);
    const text = (err as Error).message;
    expect(text).toContain('Web search is off on this machine.');
    expect(text).toContain('Get a free TinyFish key and set TINYFISH_API_KEY.');
    expect(text.split('\n')).toHaveLength(1);
    expect(text).not.toContain('—');
  });

  it('names the key to check when a key route is refused and nothing else is left', async () => {
    const { provider } = routedSearch(plan(['brave']), () =>
      unavailable('Brave refused the key (HTTP 401).'),
    );
    const err = await provider.search('x', 5).catch((e: Error) => e);
    expect((err as Error).message).toContain('Check BRAVE_API_KEY');
  });
});

describe('noRouteMessage', () => {
  it('uses the plan reason when nothing was tried', () => {
    const msg = noRouteMessage(pickSearchRoute({ ...none, override: 'tavily' }), new Map());
    expect(msg).toContain('no key is set for it (TAVILY_API_KEY or the Keychain)');
    expect(msg).toContain(
      'Set TAVILY_API_KEY or run remy search key tavily, or unset REMY_SEARCH.',
    );
  });
});

describe('makeService', () => {
  it('makes the service from its key and refuses a missing one as unavailable', () => {
    expect(makeService('brave', { BRAVE_API_KEY: 'k' }).search).toBeTypeOf('function');
    expect(() => makeService('brave', {})).toThrow(SearchUnavailable);
  });
});

describe('resolveSearchKeys', () => {
  const calls: string[][] = [];
  const exec = async (_c: string, args: string[]) => {
    calls.push(args);
    const account = args[args.indexOf('-a') + 1];
    return account === 'exa' || account === 'serper'
      ? { status: 0, stdout: `kc-${account}\n` }
      : { status: 44, stdout: '' };
  };

  it('prefers the environment, then the Keychain account named for the route', async () => {
    calls.length = 0;
    const r = await resolveSearchKeys({ SERPER_API_KEY: 'from-env' }, { platform: 'darwin', exec });
    expect(r.sources).toMatchObject({
      exa: 'keychain',
      serper: 'env',
      tinyfish: 'none',
      searxng: 'none',
    });
    expect(r.env.EXA_API_KEY).toBe('kc-exa');
    expect(r.env.SERPER_API_KEY).toBe('from-env');
    expect(r.found).toEqual([{ name: 'EXA_API_KEY', value: 'kc-exa' }]);
    expect(calls.some((a) => a.includes('serper') || a.includes('searxng'))).toBe(false);
    expect(calls[0]).toEqual(expect.arrayContaining(['-s', 'remy']));
  });

  it('skips the Keychain off macOS or with REMY_KEYCHAIN=off', async () => {
    calls.length = 0;
    expect((await resolveSearchKeys({}, { platform: 'linux', exec })).sources.exa).toBe('none');
    expect(
      (await resolveSearchKeys({ REMY_KEYCHAIN: 'off' }, { platform: 'darwin', exec })).sources.exa,
    ).toBe('none');
    expect(calls).toEqual([]);
  });

  it('reads a failing Keychain as no key', async () => {
    const r = await resolveSearchKeys(
      {},
      {
        platform: 'darwin',
        exec: async () => {
          throw new Error('locked');
        },
      },
    );
    expect(Object.values(r.sources).every((v) => v === 'none')).toBe(true);
  });
});
