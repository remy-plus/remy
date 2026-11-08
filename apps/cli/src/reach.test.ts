import { describe, expect, it } from 'vitest';
import { OPT_IN_LINE, reachLines, recommendReach } from './reach.ts';
import type { ReachFacts } from './reach-facts.ts';

const machine = (over: Partial<ReachFacts> = {}): ReachFacts => ({
  platform: 'darwin',
  arch: 'arm64',
  cores: 8,
  memoryGb: 16,
  freeDiskGb: 200,
  dockerRunning: false,
  browser: true,
  keySearch: false,
  ...over,
});

describe('recommendReach', () => {
  it('8 GB, no Docker: light, hidden browser', () => {
    const a = recommendReach(machine({ memoryGb: 8 }));
    expect(a.profile).toBe('light');
    expect(a.uses).toBe('the hidden browser');
    expect(a.step).toContain('TINYFISH_API_KEY');
  });

  it('16 GB with Docker: strong, container', () => {
    const a = recommendReach(machine({ dockerRunning: true }));
    expect(a).toMatchObject({
      profile: 'strong',
      uses: 'a container',
      step: 'Run remy browser vm start.',
    });
    expect(a.reason).toContain('16 GB');
  });

  it('16 GB without Docker: light, and the step is Docker', () => {
    const a = recommendReach(machine());
    expect(a.profile).toBe('light');
    expect(a.step).toContain('Docker');
  });

  it('64 GB: strong, with Docker', () => {
    expect(recommendReach(machine({ memoryGb: 64, cores: 16, dockerRunning: true })).profile).toBe(
      'strong',
    );
  });

  it('low disk: light even with plenty of memory and Docker', () => {
    const a = recommendReach(machine({ memoryGb: 64, dockerRunning: true, freeDiskGb: 3 }));
    expect(a.profile).toBe('light');
    expect(a.uses).toBe('the hidden browser');
    expect(a.reason).toContain('3 GB free');
    expect(a.step).toContain('Free up');
  });

  it('no browser and no key: says so and names one step', () => {
    const a = recommendReach(machine({ memoryGb: 8, browser: false }));
    expect(a.profile).toBe('light');
    expect(a.reason).toContain('No Chrome or Edge');
    expect(a.step).toContain('Install Chrome');
  });

  it('a key search route: nothing to change', () => {
    const a = recommendReach(machine({ memoryGb: 8, keySearch: true }));
    expect(a.step).toContain('Nothing to change');
  });

  it('a Linux box with no browser and room: home server, image comes in Stage 6', () => {
    const a = recommendReach(
      machine({ platform: 'linux', arch: 'x64', browser: false, dockerRunning: true }),
    );
    expect(a.profile).toBe('home-server');
    expect(a.step).toContain('Stage 6');
  });

  it('an unreadable disk is not treated as low', () => {
    const { freeDiskGb: _drop, ...rest } = machine({ dockerRunning: true });
    expect(recommendReach(rest).profile).toBe('strong');
  });
});

describe('reachLines', () => {
  it('prints the profile, the next step and the opt-ins, without hype', () => {
    const text = reachLines(recommendReach(machine({ dockerRunning: true }))).join('\n');
    expect(text).toContain('Reach: strong');
    expect(text).toContain('Next: Run remy browser vm start.');
    expect(text).toContain(OPT_IN_LINE);
    expect(text).not.toMatch(/!|—/);
  });
});
