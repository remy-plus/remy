import { describe, expect, it } from 'vitest';
import { backoffMs, rateLimitBackoffMs } from './runtime.ts';

describe('rateLimitBackoffMs', () => {
  it('starts past a short provider window and tops out at a minute', () => {
    expect(rateLimitBackoffMs(1, () => 1)).toBe(5000);
    expect(rateLimitBackoffMs(3, () => 1)).toBe(20_000);
    expect(rateLimitBackoffMs(9, () => 1)).toBe(60_000);
  });

  it('is more patient than the backoff for other errors', () => {
    expect(rateLimitBackoffMs(2, () => 0)).toBeGreaterThan(backoffMs(2, () => 0));
  });
});
