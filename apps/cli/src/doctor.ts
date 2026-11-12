// `remy doctor`: what is set up, what is not, and the next step for each. The checks are pure, so
// the facts can be gathered once and every rule tested.
import { describeOrder, routeLabel, type SearchPlan } from './search.ts';

export interface Facts {
  node: string;
  /** The default model provider, when one is logged in. */
  model?: string;
  browser: boolean;
  docker: boolean;
  daemon: boolean;
  schedules: number;
  search: SearchPlan;
  /** REMY_BROWSER picked a cloud browser: its notice, or why it cannot be used. */
  remoteBrowser?: { ok: boolean; detail: string };
  /** Problems found in the helper roles files, one line each. */
  helperProblems?: string[];
  /** Embeddings for recall; absent where the check does not apply. */
  embeddings?: { state: 'off' | 'on' | 'failed' | 'unavailable'; detail?: string };
  /** The service manager the daemon would use on this machine. */
  service?: ServiceInfo;
}

export interface ServiceInfo {
  label: string;
  enableStep: string;
  /** One line saying why the service manager cannot be used, when it cannot. */
  unavailable?: string | undefined;
}

export interface Check {
  name: string;
  status: 'ok' | 'warning' | 'problem';
  detail: string;
  fix?: string;
}

/** What the machine can tell us, each probe called at most once and only when its answer is needed. */
export interface Probes {
  node: string;
  platform: string;
  model?: string | undefined;
  hasChromeApp: () => boolean;
  daemonOn: () => boolean;
  schedules: () => number;
  /** The search route plan, already worked out from the keys and, only when needed, Docker. */
  search: SearchPlan;
  remoteBrowser?: () => { ok: boolean; detail: string } | undefined;
  helperProblems?: () => string[];
  embeddings?: () => NonNullable<Facts['embeddings']>;
  service?: () => ServiceInfo | undefined;
}

/** Facts for the checks. */
export function gatherFacts(p: Probes): Facts {
  const svc = p.service?.();
  const remote = p.remoteBrowser?.();
  return {
    node: p.node,
    ...(p.model !== undefined && { model: p.model }),
    browser: p.hasChromeApp() || p.platform !== 'darwin',
    docker: p.search.order.includes('vm'),
    daemon: (p.platform === 'darwin' || p.service !== undefined) && p.daemonOn(),
    schedules: p.schedules(),
    search: p.search,
    ...(remote && { remoteBrowser: remote }),
    ...(p.helperProblems && { helperProblems: p.helperProblems() }),
    ...(p.embeddings && { embeddings: p.embeddings() }),
    ...(svc && { service: svc }),
  };
}

const MIN_NODE = [22, 18];

function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  return (
    major > (MIN_NODE[0] as number) || (major === MIN_NODE[0] && minor >= (MIN_NODE[1] as number))
  );
}

function embeddingsCheck(e: NonNullable<Facts['embeddings']>): Check {
  if (e.state === 'failed')
    return {
      name: 'Embeddings',
      status: 'warning',
      detail: `${e.detail ?? 'the endpoint failed'}; recall uses local ranking`,
      fix: 'Check that your provider offers /embeddings and set REMY_EMBEDDING_MODEL, or unset REMY_EMBEDDINGS.',
    };
  if (e.state === 'on')
    return { name: 'Embeddings', status: 'ok', detail: 'on; note text goes to your chat provider' };
  if (e.state === 'unavailable')
    return { name: 'Embeddings', status: 'ok', detail: `on, but idle: ${e.detail ?? ''}`.trim() };
  return { name: 'Embeddings', status: 'ok', detail: 'off; recall ranks on this machine' };
}

function daemonCheck(s: ServiceInfo, on: boolean): Check {
  if (s.unavailable)
    return {
      name: 'Daemon',
      status: 'warning',
      detail: `${s.label}: ${s.unavailable}`,
      fix: 'Run remy daemon run in your own service, or leave a terminal open.',
    };
  if (on) return { name: 'Daemon', status: 'ok', detail: `on (${s.label})` };
  return { name: 'Daemon', status: 'ok', detail: `off; would use a ${s.label}`, fix: s.enableStep };
}

export function runChecks(f: Facts): Check[] {
  const search = (): Check => {
    const plan = f.search;
    if (plan.off) return { name: 'Search', status: 'ok', detail: 'off (REMY_SEARCH=off)' };
    if (!plan.chosen)
      return {
        name: 'Search',
        status: 'warning',
        detail: `off: ${plan.why ?? 'no route works here'}`,
        ...(plan.step && { fix: plan.step }),
      };
    const order = plan.order.length > 1 ? ` (order: ${describeOrder(plan.order)})` : '';
    if (plan.step)
      return {
        name: 'Search',
        status: plan.chosen === 'browser' ? 'warning' : 'ok',
        detail:
          plan.chosen === 'browser'
            ? 'hidden browser; search engines often turn it away'
            : `using ${routeLabel(plan.chosen)}${order}`,
        fix: plan.step,
      };
    return { name: 'Search', status: 'ok', detail: `using ${routeLabel(plan.chosen)}${order}` };
  };
  return [
    nodeOk(f.node)
      ? { name: 'Node', status: 'ok', detail: f.node }
      : {
          name: 'Node',
          status: 'problem',
          detail: f.node,
          fix: 'Install Node 22.18 or newer.',
        },
    f.model
      ? { name: 'Model', status: 'ok', detail: f.model }
      : { name: 'Model', status: 'problem', detail: 'none connected', fix: 'Run remy login.' },
    f.remoteBrowser
      ? {
          name: 'Browser',
          status: f.remoteBrowser.ok ? 'ok' : 'problem',
          detail: f.remoteBrowser.ok ? f.remoteBrowser.detail : 'cloud browser not usable',
          ...(!f.remoteBrowser.ok && { fix: f.remoteBrowser.detail }),
        }
      : f.browser
        ? { name: 'Browser', status: 'ok', detail: 'Chrome, Edge or Chromium found' }
        : {
            name: 'Browser',
            status: 'warning',
            detail: 'none found',
            fix: 'Install Chrome, or run remy browser install.',
          },
    search(),
    f.schedules > 0 && !f.daemon
      ? {
          name: 'Schedules',
          status: 'warning',
          detail: `${f.schedules} set, but the daemon is off`,
          fix: 'Run remy daemon install.',
        }
      : { name: 'Schedules', status: 'ok', detail: `${f.schedules} set` },
    ...(f.service ? [daemonCheck(f.service, f.daemon)] : []),
    ...(f.embeddings ? [embeddingsCheck(f.embeddings)] : []),
    ...(f.helperProblems?.length
      ? [
          {
            name: 'Helpers',
            status: 'warning' as const,
            detail: `${f.helperProblems.length} ${f.helperProblems.length === 1 ? 'problem' : 'problems'} in the roles files`,
            fix: f.helperProblems.join('\n             '),
          },
        ]
      : []),
  ];
}

export function plainChecks(checks: Check[]): string {
  const problems = checks.filter((c) => c.status === 'problem').length;
  const head = problems
    ? `${problems} ${problems === 1 ? 'problem' : 'problems'} to fix.`
    : 'All good.';
  const rows = checks.flatMap((c) => [
    `  ${c.name.padEnd(10)} ${c.status === 'ok' ? 'ok' : c.status}: ${c.detail}`,
    ...(c.fix ? [`             ${c.fix}`] : []),
  ]);
  return [head, '', ...rows].join('\n');
}
