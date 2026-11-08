import { describe, expect, it } from 'vitest';
import { BLOCK_MS, createLockout, FAILURE_WINDOW_MS } from './webhook-lockout.ts';

const clock = () => {
  let t = 1_000_000;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
};

describe('lockout', () => {
  it('blocks an address after 5 failures in a minute', () => {
    const c = clock();
    const l = createLockout(c.now);
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1');
    expect(l.blocked('1.1.1.1')).toBe(false);
    l.fail('1.1.1.1');
    expect(l.blocked('1.1.1.1')).toBe(true);
    expect(l.blocked('2.2.2.2')).toBe(false);
  });

  it('unblocks after 5 minutes', () => {
    const c = clock();
    const l = createLockout(c.now);
    for (let i = 0; i < 5; i++) l.fail('a');
    c.tick(BLOCK_MS - 1);
    expect(l.blocked('a')).toBe(true);
    c.tick(2);
    expect(l.blocked('a')).toBe(false);
  });

  it('forgets failures older than a minute', () => {
    const c = clock();
    const l = createLockout(c.now);
    for (let i = 0; i < 4; i++) l.fail('a');
    c.tick(FAILURE_WINDOW_MS + 1);
    l.fail('a');
    expect(l.blocked('a')).toBe(false);
  });
});
