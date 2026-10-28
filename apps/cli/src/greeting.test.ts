import { describe, expect, it } from 'vitest';
import { dayPart, greeting } from './greeting.ts';

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m);

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(dayPart(at(5))).toBe('morning');
    expect(dayPart(at(11, 59))).toBe('morning');
    expect(dayPart(at(12))).toBe('afternoon');
    expect(dayPart(at(16, 59))).toBe('afternoon');
    expect(dayPart(at(17))).toBe('evening');
    expect(dayPart(at(23))).toBe('evening');
    expect(dayPart(at(3))).toBe('evening');
  });
  it('adds the name when there is one', () => {
    expect(greeting(at(19), 'Sam')).toBe('Good evening, Sam.');
    expect(greeting(at(8), '  Ana ')).toBe('Good morning, Ana.');
    expect(greeting(at(13))).toBe('Good afternoon.');
    expect(greeting(at(13), '  ')).toBe('Good afternoon.');
  });
});
