// `remy doctor`: what is set up, what is not, and the next step for each. The checks are pure, so
// the facts can be gathered once and every rule tested.
export interface Facts {
  node: string;
  /** The default model provider, when one is logged in. */
  model?: string;
  browser: boolean;
  docker: boolean;
  daemon: boolean;
  schedules: number;
  search: string;
}

export interface Check {
  name: string;
  status: 'ok' | 'warning' | 'problem';
  detail: string;
  fix?: string;
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
    if (f.search !== 'browser')
      return { name: 'Search', status: 'ok', detail: `using ${f.search}` };
    return {
      name: 'Search',
      status: 'warning',
      detail: 'hidden browser; search engines often turn it away',
      fix: f.docker
        ? 'Run remy browser vm start for better results.'
        : 'Install Docker or Colima, then run remy browser vm start, or set REMY_SEARCH.',
    };
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
