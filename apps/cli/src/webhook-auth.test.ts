import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authorized, bearer, safeEqual } from './webhook-auth.ts';
import { sha256Hex } from './webhook-token.ts';

const shared = 'S'.repeat(43);
const hook = { name: 'a', prompt: 'p', createdAt: 'x' };

describe('bearer', () => {
  it('takes only "Bearer <token>"', () => {
    expect(bearer('Bearer abc')).toBe('abc');
    for (const bad of [undefined, '', 'abc', 'Basic abc', 'Bearer', 'Bearer a b', ['Bearer a']])
      expect(bearer(bad as string)).toBeUndefined();
  });
});

describe('safeEqual', () => {
  it('compares any lengths without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'abc')).toBe(false);
  });

  it('is built on timingSafeEqual, with no plain comparison of tokens', () => {
    const src = readFileSync(new URL('./webhook-auth.ts', import.meta.url), 'utf8');
    expect(src).toContain('timingSafeEqual(');
    expect(src).not.toMatch(/\bgiven\s*===\s*shared|\bshared\s*===\s*given|\.tokenHash\s*===/);
  });
});

describe('authorized', () => {
  it('accepts the shared token', () => {
    expect(authorized(`Bearer ${shared}`, hook, shared)).toBe(true);
  });
  it('refuses a wrong, missing or malformed token', () => {
    expect(authorized('Bearer nope', hook, shared)).toBe(false);
    expect(authorized(undefined, hook, shared)).toBe(false);
    expect(authorized(shared, hook, shared)).toBe(false);
  });
  it('a hook with its own token accepts only that one', () => {
    const own = { ...hook, tokenHash: sha256Hex('mine') };
    expect(authorized('Bearer mine', own, shared)).toBe(true);
    expect(authorized(`Bearer ${shared}`, own, shared)).toBe(false);
  });
  it('a hook that does not exist accepts only the shared token', () => {
    expect(authorized(`Bearer ${shared}`, undefined, shared)).toBe(true);
    expect(authorized('Bearer mine', undefined, shared)).toBe(false);
  });
});
