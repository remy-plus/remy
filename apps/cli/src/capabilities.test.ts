import { describe, expect, it } from 'vitest';
import { capabilitiesBlock, MAX_CAPABILITY_LINES, onceCapabilities } from './capabilities.ts';
import type { Facts } from './doctor.ts';
import { gatherFacts } from './doctor.ts';
import { situationBlock } from './situation.ts';

const bare: Facts = {
  node: 'v26.1.0',
  model: 'sk-SECRET-KEY-123',
  browser: false,
  docker: false,
  daemon: false,
  schedules: 2,
  search: 'browser',
};
const full: Facts = { ...bare, browser: true, docker: true, daemon: true, search: 'tinyfish' };

describe('capabilitiesBlock trust line', () => {
  it('is absent at ask and names what still asks above it', () => {
    expect(
      capabilitiesBlock({ facts: full, helpers: true, skills: 1, trust: 'ask' }),
    ).not.toContain('Trust');
    const out = capabilitiesBlock({ facts: full, helpers: true, skills: 1, trust: 'away' });
    expect(out).toContain('- Trust: away');
    expect(out).toContain('sending, spending, deleting');
    expect(out.split('\n').length).toBeLessThanOrEqual(MAX_CAPABILITY_LINES + 1);
  });
});

describe('capabilitiesBlock', () => {
  it('names each gap with the single step that fixes it when nothing is set up', () => {
    const out = capabilitiesBlock({ facts: bare, helpers: false, skills: 0 });
    expect(out).toContain('Browser: none found. Ask the user: Install Chrome');
    expect(out).toContain('Web search: hidden browser');
    expect(out).toContain('Ask the user: Install Docker or Colima');
    expect(out).toContain('ask the user to run `remy connect`');
    expect(out).toContain(
      'Schedules: 2 set, but the daemon is off. Ask the user: Run remy daemon install',
    );
    expect(out).toContain('Helpers: off. Ask the user to set REMY_HELPERS=on');
    expect(out).toContain('Skills: 0');
  });

  it('states what works, with no asks, when everything is set up', () => {
    const out = capabilitiesBlock({ facts: full, helpers: true, skills: 3 });
    expect(out).toContain('Web search: using tinyfish.');
    expect(out).toContain('Browser: available.');
    expect(out).toContain('Schedules: 2 set.');
    expect(out).toContain('Helpers: on.');
    expect(out).toContain('Skills: 3.');
    expect(out).not.toMatch(/Ask the user: /);
  });

  it('never leaks the model or key from the facts', () => {
    for (const facts of [bare, full]) {
      const out = capabilitiesBlock({ facts, helpers: false, skills: 1 });
      expect(out).not.toContain('SECRET');
      expect(out).not.toContain('sk-');
    }
  });

  it('stays within the line cap', () => {
    const out = capabilitiesBlock({ facts: bare, helpers: false, skills: 9 });
    expect(out.split('\n').length).toBeLessThanOrEqual(MAX_CAPABILITY_LINES + 1);
  });

  it('is computed once per process', () => {
    let n = 0;
    const get = onceCapabilities(() => `block ${++n}`);
    expect([get(), get(), get()]).toEqual(['block 1', 'block 1', 'block 1']);
    expect(n).toBe(1);
  });

  it('rides in the situation block', () => {
    const out = situationBlock({
      now: new Date('2026-11-07T10:00:00Z'),
      timeZone: 'UTC',
      background: [],
      connections: [],
      capabilities: capabilitiesBlock({ facts: full, helpers: false, skills: 0 }),
    });
    expect(out).toContain('Local time');
    expect(out).toContain('Capabilities on this machine');
  });
});

describe('gatherFacts', () => {
  const probes = (over: object = {}) => {
    const calls: string[] = [];
    const p = {
      node: 'v26.1.0',
      platform: 'darwin',
      hasChromeApp: () => (calls.push('chrome'), false),
      hasDocker: () => (calls.push('docker'), true),
      daemonOn: () => (calls.push('daemon'), true),
      schedules: () => 1,
      search: 'tinyfish',
      ...over,
    };
    return { p, calls };
  };

  it('skips the slow Docker probe unless search falls back to the browser', () => {
    const a = probes();
    expect(gatherFacts(a.p).docker).toBe(false);
    expect(a.calls).not.toContain('docker');
    const b = probes({ search: 'browser' });
    expect(gatherFacts(b.p).docker).toBe(true);
  });

  it('treats a non-Mac as having a browser and no launchd daemon', () => {
    const f = gatherFacts(probes({ platform: 'linux' }).p);
    expect(f.browser).toBe(true);
    expect(f.daemon).toBe(false);
  });
});
