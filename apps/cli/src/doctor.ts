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
  /** Problems found in the helper roles files, one line each. */
  helperProblems?: string[];
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
  helperProblems?: () => string[];
}

/** Facts for the checks. */
export function gatherFacts(p: Probes): Facts {
  return {
    node: p.node,
    ...(p.model !== undefined && { model: p.model }),
    browser: p.hasChromeApp() || p.platform !== 'darwin',
    docker: p.search.order.includes('vm'),
    daemon: p.platform === 'darwin' && p.daemonOn(),
    schedules: p.schedules(),
    search: p.search,
    ...(p.helperProblems && { helperProblems: p.helperProblems() }),
  };
}

const MIN_NODE = [22, 18];

function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  return (
    major > (MIN_NODE[0] as number) || (major === MIN_NODE[0] && minor >= (MIN_NODE[1] as number))
  );
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
    f.browser
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
