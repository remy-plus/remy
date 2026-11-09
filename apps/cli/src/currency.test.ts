import { describe, expect, it } from 'vitest';
import { formatMoney, isCurrencyCode, symbolOf } from './currency.ts';

describe('display currency', () => {
  it('formats dollars by default', () => {
    expect(formatMoney(1.5)).toBe('$1.50');
  });
  it('converts at the rate the person set', () => {
    expect(formatMoney(2, { code: 'GBP', perUsd: 0.79 })).toBe('£1.58');
    expect(formatMoney(2, { code: 'JPY', perUsd: 150 })).toBe('¥300');
  });
  it('knows real codes and rejects the rest', () => {
    expect(isCurrencyCode('INR')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('ZZZZ')).toBe(false);
    expect(symbolOf('EUR')).toBe('€');
  });
});
