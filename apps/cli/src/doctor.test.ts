import { describe, expect, it } from 'vitest';
import { type Check, plainChecks, runChecks } from './doctor.ts';

describe('runChecks', () => {
  const facts = {
    node: 'v26.1.0',
    model: 'openai',
    browser: true,
    docker: false,
    daemon: false,
    schedules: 0,
    search: 'browser',
  };

  it('passes a healthy setup', () => {
    const checks = runChecks(facts);
    expect(checks.filter((c) => c.status === 'problem')).toEqual([]);
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

  it('says hidden search can be weak and how to do better', () => {
    const c = runChecks({ ...facts, docker: true }).find((x) => x.name === 'Search');
    expect(c?.status).toBe('warning');
    expect(c?.fix).toContain('remy browser vm start');
  });

  it('is happy with container search', () => {
    const c = runChecks({ ...facts, search: 'vm' }).find((x) => x.name === 'Search');
    expect(c?.status).toBe('ok');
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
