import { describe, expect, it } from 'vitest';
import { ago, clock, greeting, group } from './when.ts';

const now = new Date(2026, 10, 10, 18, 40, 0); // 10 Nov 2026, 6:40 PM local
const at = (ms: number) => new Date(now.getTime() - ms);

describe('when', () => {
  it('says just now, minutes and hours', () => {
    expect(ago(at(10_000), now)).toBe('just now');
    expect(ago(at(5 * 60_000), now)).toBe('5 min ago');
    expect(ago(at(2 * 3_600_000), now)).toBe('2 hours ago');
  });
  it('says yesterday and a weekday, then a date', () => {
    expect(ago(new Date(2026, 10, 9, 9, 0), now)).toBe('yesterday');
    expect(ago(new Date(2026, 10, 6, 9, 0), now)).toMatch(/Fri/);
    expect(ago(new Date(2026, 9, 12, 9, 0), now)).toMatch(/12.*Oct|Oct.*12/);
  });
  it('never prints military time', () => {
    expect(clock(new Date(2026, 10, 10, 18, 41))).toMatch(/6:41\s?PM/i);
    expect(clock(new Date(2026, 10, 10, 7, 5))).toMatch(/7:05\s?AM/i);
  });
  it('greets by the hour', () => {
    expect(greeting(new Date(2026, 10, 10, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 10, 10, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 10, 10, 20))).toBe('Good evening');
    expect(greeting(new Date(2026, 10, 10, 2))).toBe('Still up');
  });
  it('groups chats by day', () => {
    expect(group(new Date(2026, 10, 10, 1), now)).toBe('Today');
    expect(group(new Date(2026, 10, 9, 23), now)).toBe('Yesterday');
    expect(group(new Date(2026, 10, 6), now)).toBe('This week');
    expect(group(new Date(2026, 9, 1), now)).toBe('Earlier');
  });
});
