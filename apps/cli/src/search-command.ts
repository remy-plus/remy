// `remy search`: which route answers web search and why, `remy search key <service>` to save a
// key in the Keychain, `remy search test [<service>]` to run one real search. A key is never printed.
import { type Exec, keychainSet, realExec } from './credentials.ts';
import {
  describeOrder,
  type KeyRoute,
  type KeySource,
  makeService,
  type Route,
  routeLabel,
  SERVICES,
  type SearchPlan,
} from './search.ts';

export const TEST_QUERY = 'current Node.js LTS release';

export interface SearchCommandContext {
  rest: string[];
  keyStdin: boolean;
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  isTTY: boolean;
  out: (text: string) => void;
  plan: SearchPlan;
  sources: Record<KeyRoute, KeySource>;
  readStdin?: (() => Promise<string>) | undefined;
  askSecret?: ((question: string) => Promise<string | null>) | undefined;
  exec?: Exec;
  /** Overrides the service call (tests). */
  makeProvider?: typeof makeService;
  now?: () => number;
}

const ids = Object.keys(SERVICES) as KeyRoute[];
const isService = (v: string | undefined): v is KeyRoute => !!v && (ids as string[]).includes(v);
const where = (r: KeyRoute, src: KeySource) =>
  src === 'env' ? `env (${SERVICES[r].env})` : src === 'keychain' ? 'Keychain' : 'none';

function status(c: SearchCommandContext): string[] {
  const p = c.plan;
  const lines: string[] = [];
  if (p.off) lines.push('Search is off (REMY_SEARCH=off).');
  else if (!p.chosen) {
    lines.push(`Search is off: ${p.why ?? 'no route works here'}.`);
    if (p.step) lines.push(`Next step: ${p.step}`);
  } else {
    const why = p.override
      ? 'REMY_SEARCH or remy.config.json picked it'
      : p.chosen in SERVICES
        ? 'the first service with a key'
        : 'no service key is set';
    lines.push(`Web search uses ${routeLabel(p.chosen)}: ${why}.`);
    if (p.order.length > 1) lines.push(`Order: ${describeOrder(p.order)}.`);
    if (p.step) lines.push(`Next step: ${p.step}`);
  }
  lines.push('', 'Services, in the order they are tried:');
  for (const r of ids)
    lines.push(`  ${r.padEnd(11)} ${SERVICES[r].label.padEnd(12)} key: ${where(r, c.sources[r])}`);
  lines.push(
    '',
    'Save a key with remy search key <service>. Check one with remy search test <service>.',
  );
  return lines;
}

async function saveKey(c: SearchCommandContext, id: string | undefined): Promise<number> {
  if (!isService(id) || id === 'searxng')
    throw new Error(
      `Usage: remy search key <service>. Services: ${ids.filter((i) => i !== 'searxng').join(', ')}.`,
    );
  const platform = c.platform ?? process.platform;
  if (platform !== 'darwin' || c.env.REMY_KEYCHAIN === 'off') {
    c.out(`The Keychain is not used here. Set ${SERVICES[id].env} in the environment instead.\n`);
    return 1;
  }
  let value: string | null | undefined;
  if (c.keyStdin || !c.isTTY) value = (await c.readStdin?.()) ?? '';
  else if (c.askSecret) value = await c.askSecret(`${SERVICES[id].label} key (hidden): `);
  else
    throw new Error(
      'Run this in a terminal, or pipe the key: remy search key <service> --key-stdin.',
    );
  value = value?.trim();
  if (!value) throw new Error('No key was given. Nothing was saved.');
  if (!keychainSet(c.exec ?? realExec, id, value))
    throw new Error('The Keychain would not take that key. Set the environment variable instead.');
  c.out(
    `Saved the ${SERVICES[id].label} key in the Keychain. Check it with remy search test ${id}.\n`,
  );
  return 0;
}

async function test(c: SearchCommandContext, id: string | undefined): Promise<number> {
  let route: Route | undefined;
  if (id) {
    if (!isService(id)) throw new Error(`Unknown service "${id}". Services: ${ids.join(', ')}.`);
    route = id;
  } else route = c.plan.chosen;
  if (!route || !(route in SERVICES))
    throw new Error(
      `Name a service to test: remy search test <service>. Services: ${ids.join(', ')}.`,
    );
  const svc = route as KeyRoute;
  if (c.sources[svc] === 'none')
    throw new Error(
      svc === 'searxng'
        ? `SearXNG needs SEARXNG_URL, which is not set.`
        : `No ${SERVICES[svc].label} key found. Run remy search key ${svc} or set ${SERVICES[svc].env}.`,
    );
  const now = c.now ?? Date.now;
  const t0 = now();
  const results = await (c.makeProvider ?? makeService)(svc, c.env).search(TEST_QUERY, 3);
  const ms = now() - t0;
  if (results.length === 0) {
    c.out(`${SERVICES[svc].label} answered in ${ms} ms with no results.\n`);
    return 1;
  }
  c.out(`${SERVICES[svc].label} answered in ${ms} ms:\n`);
  results.slice(0, 3).forEach((r, i) => {
    c.out(`${i + 1}. ${r.title || '(no title)'}\n   ${r.url}\n`);
  });
  return 0;
}

export async function searchCommand(c: SearchCommandContext): Promise<number> {
  const [sub, id] = c.rest;
  if (!sub) {
    c.out(`${status(c).join('\n')}\n`);
    return 0;
  }
  if (sub === 'key') return saveKey(c, id);
  if (sub === 'test') return test(c, id);
  throw new Error('Use remy search, remy search key <service> or remy search test [<service>].');
}
