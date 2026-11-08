import { describe, expect, it } from 'vitest';
import { type Check, plainChecks, runChecks } from './doctor.ts';
import { pickSearchRoute } from './search.ts';

const plan = (over: object = {}) =>
  pickSearchRoute({ keys: {}, docker: false, vmSetUp: false, browser: true, ...over });

describe('runChecks', () => {
  const facts = {
    node: 'v26.1.0',
    model: 'openai',
    browser: true,
    docker: false,
    daemon: false,
    schedules: 0,
    search: plan(),
  };

  it('passes a healthy setup', () => {
    const checks = runChecks(facts);
    expect(checks.filter((c) => c.status === 'problem')).toEqual([]);
  });

  it('lists helper role problems as a warning, never a problem', () => {
    const c = runChecks({ ...facts, helperProblems: ['a, line 3: bad', 'b, line 1: worse'] }).find(
      (x) => x.name === 'Helpers',
    );
    expect(c?.status).toBe('warning');
    expect(c?.fix).toContain('line 3: bad');
    expect(c?.fix).toContain('line 1: worse');
  });

  it('flags an old Node with what to do', () => {
    const c = runChecks({ ...facts, node: 'v20.1.0' }).find((x) => x.name === 'Node');
    expect(c?.status).toBe('problem');
    expect(c?.fix).toContain('22.18');
  });

  it('accepts exactly the lowest Node', () => {
    const c = runChecks({ ...facts, node: 'v22.18.0' }).find((x) => x.name === 'Node');
    expect(c?.status).toBe('ok');
  });

  it('flags a missing model', () => {
    const c = runChecks({ ...facts, model: undefined }).find((x) => x.name === 'Model');
    expect(c?.status).toBe('problem');
    expect(c?.fix).toContain('remy login');
  });

  it('warns when schedules exist but the daemon is off', () => {
    const c = runChecks({ ...facts, schedules: 2 }).find((x) => x.name === 'Schedules');
    expect(c?.status).toBe('warning');
    expect(c?.fix).toContain('remy daemon install');
  });

  it('says hidden search can be weak and names one step to do better', () => {
    const c = runChecks(facts).find((x) => x.name === 'Search');
    expect(c?.status).toBe('warning');
    expect(c?.fix).toContain('TINYFISH_API_KEY');
    const d = runChecks({ ...facts, search: plan({ docker: true }) }).find(
      (x) => x.name === 'Search',
    );
    expect(d?.fix).toContain('remy browser vm start');
  });

  it('shows the chosen route and the order when more than one works', () => {
    const c = runChecks({
      ...facts,
      search: plan({ keys: { tinyfish: true }, docker: true, vmSetUp: true }),
    }).find((x) => x.name === 'Search');
    expect(c).toMatchObject({ status: 'ok' });
    expect(c?.detail).toBe(
      'using TinyFish (order: TinyFish, then the container, then the hidden browser)',
    );
    expect(c?.fix).toBeUndefined();
  });

  it('is happy with container search, and offers a key for steadier results', () => {
    const c = runChecks({
      ...facts,
      search: plan({ docker: true, vmSetUp: true, override: 'vm' }),
    }).find((x) => x.name === 'Search');
    expect(c?.status).toBe('ok');
    expect(c?.detail).toBe('using the container');
  });

  it('says search is off and why when no route works', () => {
    const c = runChecks({ ...facts, search: plan({ browser: false }) }).find(
      (x) => x.name === 'Search',
    );
    expect(c?.status).toBe('warning');
    expect(c?.detail).toContain('off: no search key is set');
    expect(c?.fix).toBe('Get a free TinyFish key and set TINYFISH_API_KEY.');
  });
});

describe('plainChecks', () => {
  const checks: Check[] = [
    { name: 'Node', status: 'ok', detail: 'v26' },
    { name: 'Model', status: 'problem', detail: 'none', fix: 'Run remy login.' },
  ];

  it('leads with the outcome', () => {
    expect(plainChecks(checks).split('\n')[0]).toBe('1 problem to fix.');
    expect(plainChecks([checks[0] as Check]).split('\n')[0]).toBe('All good.');
  });

  it('shows the fix under the check', () => {
    expect(plainChecks(checks)).toContain('Run remy login.');
  });
});

describe('daemon check', () => {
  const base = {
    node: 'v26.1.0',
    model: 'openai',
    browser: true,
    docker: false,
    daemon: false,
    schedules: 0,
    search: plan(),
  };
  const find = (f: object) => runChecks({ ...base, ...f }).find((c) => c.name === 'Daemon');

  it('shows nothing where no installer applies', () => {
    expect(find({})).toBeUndefined();
  });

  it('names the installer and the one step to turn it on', () => {
    expect(
      find({ service: { label: 'systemd user unit', enableStep: 'Run remy daemon install.' } }),
    ).toEqual({
      name: 'Daemon',
      status: 'ok',
      detail: 'off; would use a systemd user unit',
      fix: 'Run remy daemon install.',
    });
  });

  it('says on when it is on', () => {
    const c = find({ daemon: true, service: { label: 'Windows Scheduled Task', enableStep: 'x' } });
    expect(c?.detail).toBe('on (Windows Scheduled Task)');
    expect(c?.fix).toBeUndefined();
  });

  it('says when the service manager is not there and what to run instead', () => {
    const c = find({
      service: { label: 'systemd user unit', enableStep: 'x', unavailable: 'no systemctl.' },
    });
    expect(c?.status).toBe('warning');
    expect(c?.detail).toBe('systemd user unit: no systemctl.');
    expect(c?.fix).toContain('remy daemon run');
  });
});
