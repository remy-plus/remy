import { describe, expect, it } from 'vitest';
import { live } from './cases/index.ts';
import { resolveGroups } from './suite-alias.ts';

const hard = live.filter((c) => c.id.startsWith('live-hard-')).map((c) => c.id);

describe('live-hard group', () => {
  it('has about 14 cases, all live, with unique ids', () => {
    expect(hard.length).toBeGreaterThanOrEqual(12);
    expect(new Set(live.map((c) => c.id)).size).toBe(live.length);
    for (const id of hard) expect(id).toMatch(/^live-[a-z0-9-]+$/);
  });

  it('picks only the group from --suite live-hard', () => {
    const r = resolveGroups(['live-hard'], [], live);
    expect(r.suites).toEqual(['live']);
    expect(r.caseIds.sort()).toEqual([...hard].sort());
  });

  it('leaves other suites alone and runs all of live when asked next to its group', () => {
    expect(resolveGroups(['hard'], [], live)).toEqual({ suites: ['hard'], caseIds: [] });
    expect(resolveGroups(['live', 'live-hard'], [], live)).toEqual({
      suites: ['live'],
      caseIds: [],
    });
    expect(resolveGroups(['live-hard'], ['live-python'], live).caseIds).toContain('live-python');
  });
});
