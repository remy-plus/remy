import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openHooks } from './webhook-store.ts';

const open = () => {
  const home = mkdtempSync(join(tmpdir(), 'remy-hooks-'));
  return { home, store: openHooks(home) };
};
const now = new Date('2026-11-08T09:00:00Z');

describe('hook store', () => {
  it('is empty and off by default', () => {
    const { store } = open();
    expect(store.list()).toEqual([]);
    expect(store.enabled()).toBe(false);
  });

  it('saves a hook in a 0600 file', () => {
    const { home, store } = open();
    store.add('deploys', 'Summarise the deploy', now);
    expect(store.get('deploys')?.prompt).toBe('Summarise the deploy');
    expect(statSync(join(home, 'webhooks.json')).mode & 0o777).toBe(0o600);
  });

  it('refuses bad names, empty and long prompts, and duplicates', () => {
    const { store } = open();
    for (const bad of ['', 'A', '../x', 'a b', 'a/b', '-x', 'x'.repeat(41)])
      expect(() => store.add(bad, 'p', now)).toThrow();
    expect(() => store.add('ok', '   ', now)).toThrow();
    expect(() => store.add('ok', 'x'.repeat(2001), now)).toThrow();
    store.add('ok', 'p', now);
    expect(() => store.add('ok', 'p', now)).toThrow(/already/);
  });

  it('removes a hook and keeps the enabled flag', () => {
    const { store } = open();
    store.add('a', 'p', now);
    store.setEnabled(true);
    expect(store.remove('a')).toBe(true);
    expect(store.remove('a')).toBe(false);
    expect(store.enabled()).toBe(true);
  });

  it('sets and clears a hook token hash', () => {
    const { store } = open();
    store.add('a', 'p', now);
    expect(store.setTokenHash('a', 'abc')).toBe(true);
    expect(store.get('a')?.tokenHash).toBe('abc');
    store.setTokenHash('a', undefined);
    expect(store.get('a')?.tokenHash).toBeUndefined();
    expect(store.setTokenHash('nope', 'x')).toBe(false);
  });
});
