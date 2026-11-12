// Which route answers web_search. The order is fixed and explained: a search service whose key is
// set (in the environment, else the macOS Keychain), then the container, then Remy's own hidden browser, else none. REMY_SEARCH overrides it.
// A route that cannot recover (bad key, Docker gone, a bot check) is dropped for the rest of the
// process and the next one answers. Nothing here ever opens a window.
import {
  braveSearch,
  contextDevSearch,
  exaSearch,
  linkupSearch,
  perplexitySearch,
  type SearchProvider,
  SearchUnavailable,
  searxngSearch,
  serperSearch,
  tavilySearch,
  tinyfishSearch,
} from '@remy/tools';
import { KEYCHAIN_SERVICE } from './credentials.ts';
import { type AsyncExec, KEYCHAIN_TIMEOUT_MS, realAsyncExec } from './serve-voice.ts';

export const SEARCH_CHOICES = [
  'browser',
  'vm',
  'context',
  'brave',
  'tavily',
  'tinyfish',
  'exa',
  'perplexity',
  'linkup',
  'serper',
  'searxng',
  'off',
] as const;
export type SearchChoice = (typeof SEARCH_CHOICES)[number];

export const isSearchChoice = (v: string): v is SearchChoice =>
  (SEARCH_CHOICES as readonly string[]).includes(v);

/** Services with a key, in the order they are tried. */
export const SERVICES = {
  exa: { env: 'EXA_API_KEY', label: 'Exa', make: exaSearch },
  tinyfish: { env: 'TINYFISH_API_KEY', label: 'TinyFish', make: tinyfishSearch },
  perplexity: { env: 'PERPLEXITY_API_KEY', label: 'Perplexity', make: perplexitySearch },
  tavily: { env: 'TAVILY_API_KEY', label: 'Tavily', make: tavilySearch },
  linkup: { env: 'LINKUP_API_KEY', label: 'Linkup', make: linkupSearch },
  serper: { env: 'SERPER_API_KEY', label: 'Serper', make: serperSearch },
  brave: { env: 'BRAVE_API_KEY', label: 'Brave', make: braveSearch },
  context: { env: 'CONTEXT_DEV_API_KEY', label: 'Context.dev', make: contextDevSearch },
  searxng: { env: 'SEARXNG_URL', label: 'SearXNG', make: searxngSearch },
} as const;
export type KeyRoute = keyof typeof SERVICES;
export type Route = KeyRoute | 'vm' | 'browser';

export const routeLabel = (r: Route): string =>
  r === 'vm' ? 'the container' : r === 'browser' ? 'the hidden browser' : SERVICES[r].label;

/** What the machine has, read from the doctor checks and the environment; no slow probes here. */
export interface SearchFacts {
  /** REMY_SEARCH or `search` in remy.config.json. */
  override?: string | undefined;
  keys: Partial<Record<KeyRoute, boolean>>;
  /** Docker answers. */
  docker: boolean;
  /** `remy browser vm start` has been run on this machine. */
  vmSetUp: boolean;
  /** A browser is installed and not switched off. */
  browser: boolean;
}

export interface SearchPlan {
  /** Routes in the order they are tried. Empty when search is off or nothing works. */
  order: Route[];
  chosen?: Route;
  /** REMY_SEARCH set it. */
  override: boolean;
  /** Search was switched off on purpose. */
  off: boolean;
  /** The one step that would make search better or work at all. Absent when nothing is needed. */
  step?: string;
  /** Why there is no route, when there is none. */
  why?: string;
}

const TINYFISH_STEP = 'Get a free TinyFish key and set TINYFISH_API_KEY.';

/** The route order for a machine. Pure. */
export function pickSearchRoute(f: SearchFacts): SearchPlan {
  const want = f.override?.trim().toLowerCase();
  if (want) {
    if (!isSearchChoice(want))
      return {
        order: [],
        override: true,
        off: false,
        why: `REMY_SEARCH is "${f.override}", which is not a route`,
        step: `Set REMY_SEARCH to one of ${SEARCH_CHOICES.join(', ')}, or unset it.`,
      };
    if (want === 'off') return { order: [], override: true, off: true };
    if (want === 'browser' || want === 'vm')
      return { order: [want], chosen: want, override: true, off: false };
    if (!f.keys[want])
      return {
        order: [],
        override: true,
        off: false,
        why: `REMY_SEARCH picks ${SERVICES[want].label} but no key is set for it (${SERVICES[want].env} or the Keychain)`,
        step: `Set ${SERVICES[want].env}${want === 'searxng' ? '' : ` or run remy search key ${want}`}, or unset REMY_SEARCH.`,
      };
    return { order: [want], chosen: want, override: true, off: false };
  }
  const order: Route[] = [
    ...(Object.keys(SERVICES) as KeyRoute[]).filter((k) => f.keys[k]),
    ...(f.docker && f.vmSetUp ? (['vm'] as const) : []),
    ...(f.browser ? (['browser'] as const) : []),
  ];
  const [chosen] = order;
  if (chosen && chosen in SERVICES) return { order, chosen, override: false, off: false };
  const step =
    f.docker && !f.vmSetUp
      ? 'Run remy browser vm start, or get a free TinyFish key and set TINYFISH_API_KEY.'
      : TINYFISH_STEP;
  return {
    order,
    ...(chosen && { chosen }),
    override: false,
    off: false,
    step,
    ...(!chosen && {
      why: `no search key is set, ${f.docker ? 'the container is not set up' : 'Docker is not running'} and no browser is available`,
    }),
  };
}

/** `Searched ...` order in one phrase for `remy doctor`. */
export const describeOrder = (order: Route[]): string => order.map(routeLabel).join(', then ');

/** What `web_search` says when no route answers: short, plain, and one step. */
export function noRouteMessage(plan: SearchPlan, dead: ReadonlyMap<Route, string>): string {
  const reasons = [...dead.values()];
  const why = reasons.length ? reasons.join(' ') : `${plan.why ?? 'No search route works here'}.`;
  const authFailed = [...dead.entries()].find(([r]) => r in SERVICES);
  const step = authFailed
    ? `Check ${SERVICES[authFailed[0] as KeyRoute].env}, or get a free TinyFish key and set TINYFISH_API_KEY.`
    : (plan.step ?? TINYFISH_STEP);
  return `Web search is off on this machine. ${why} Next step for the user: ${step} Do not answer from memory.`;
}

export interface Routed {
  provider: SearchProvider;
  /** Routes dropped for this process, with the reason. */
  dead: ReadonlyMap<Route, string>;
}

/**
 * A provider that walks the plan's routes. A route that fails in a way that will not fix itself is
 * dropped for the rest of the process and the next is tried once; any other failure is returned as
 * it is. Results carry the route that answered. A bot check only ever drops the route.
 */
export function routedSearch(plan: SearchPlan, make: (route: Route) => SearchProvider): Routed {
  const dead = new Map<Route, string>();
  const made = new Map<Route, SearchProvider>();
  const provider: SearchProvider = {
    async search(query, count) {
      for (const route of plan.order) {
        if (dead.has(route)) continue;
        try {
          const p = made.get(route) ?? make(route);
          made.set(route, p);
          const results = await p.search(query, count);
          return results.map((r) => ({ ...r, via: routeLabel(route) }));
        } catch (e) {
          if (!(e instanceof SearchUnavailable)) throw e;
          dead.set(route, e.message);
        }
      }
      throw new SearchUnavailable(noRouteMessage(plan, dead));
    },
  };
  return { provider, dead };
}

/** The service behind a key route, from the environment. */
export function makeService(
  route: KeyRoute,
  env: Record<string, string | undefined>,
): SearchProvider {
  const s = SERVICES[route];
  const value = env[s.env];
  if (!value) throw new SearchUnavailable(`${s.label} needs ${s.env}, which is not set.`);
  return s.make(value);
}

/** Facts from the environment, probing Docker only when no pick or key already settles the route. */
export function gatherSearchPlan(p: {
  env: Record<string, string | undefined>;
  override: string | undefined;
  vmSetUp: boolean;
  browser: boolean;
  hasDocker: () => boolean;
}): SearchPlan {
  const keys = Object.fromEntries(
    (Object.keys(SERVICES) as KeyRoute[]).map((k) => [k, Boolean(p.env[SERVICES[k].env])]),
  ) as Record<KeyRoute, boolean>;
  const settled = Boolean(p.override?.trim()) || Object.values(keys).some(Boolean);
  return pickSearchRoute({
    override: p.override,
    keys,
    docker: settled ? false : p.hasDocker(),
    vmSetUp: p.vmSetUp,
    browser: p.browser,
  });
}

export type KeySource = 'env' | 'keychain' | 'none';

/** Services whose key may live in the Keychain (SearXNG is an address, not a key). */
export const KEYED_ROUTES = (Object.keys(SERVICES) as KeyRoute[]).filter((k) => k !== 'searxng');

/**
 * Where each service's key comes from: the environment first, then (macOS, REMY_KEYCHAIN not off)
 * the Keychain under service `remy`, account = the route id. Lookups run in parallel, never block
 * the event loop, and a slow or locked Keychain reads as "no key". `env` is the input plus any key
 * found, and `found` lists the keys read from the Keychain so the caller can register them to be
 * redacted.
 */
export async function resolveSearchKeys(
  env: Record<string, string | undefined>,
  opts: { platform?: NodeJS.Platform; exec?: AsyncExec; timeoutMs?: number } = {},
): Promise<{
  env: Record<string, string | undefined>;
  sources: Record<KeyRoute, KeySource>;
  found: { name: string; value: string }[];
}> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? realAsyncExec;
  const useKeychain = platform === 'darwin' && env.REMY_KEYCHAIN !== 'off';
  const out = { ...env };
  const found: { name: string; value: string }[] = [];
  const sources = {} as Record<KeyRoute, KeySource>;
  await Promise.all(
    (Object.keys(SERVICES) as KeyRoute[]).map(async (route) => {
      const name = SERVICES[route].env;
      if (env[name]?.trim()) {
        sources[route] = 'env';
        return;
      }
      sources[route] = 'none';
      if (!useKeychain || route === 'searxng') return;
      try {
        const r = await exec(
          'security',
          ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', route, '-w'],
          opts.timeoutMs ?? KEYCHAIN_TIMEOUT_MS,
        );
        const value = r.stdout.replace(/\r?\n$/, '').trim();
        if (r.status === 0 && value) {
          out[name] = value;
          sources[route] = 'keychain';
          found.push({ name, value });
        }
      } catch {
        // A locked or slow Keychain is "no key".
      }
    }),
  );
  return { env: out, sources, found };
}
