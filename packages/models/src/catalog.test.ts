import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CATALOG, DEFAULT_CAPS, loadCatalog, resolveCaps } from './catalog.ts';
import { costUsd } from './pricing.ts';

describe('costUsd', () => {
  it('prices per million tokens', () => {
    expect(
      costUsd({ inTokens: 1_000_000, outTokens: 500_000 }, { inPerMTok: 2, outPerMTok: 10 }),
    ).toBe(7);
    expect(costUsd({ inTokens: 123, outTokens: 456 }, { inPerMTok: 0, outPerMTok: 0 })).toBe(0);
  });
});

describe('catalog', () => {
  it('defaults unknown models', () => {
    expect(resolveCaps('mystery/model')).toEqual(DEFAULT_CAPS);
  });

  it('merges partial entries, including pricing', () => {
    const caps = resolveCaps('m', {
      m: { nativeTools: false, pricing: { inPerMTok: 1, outPerMTok: 2 } },
    });
    expect(caps).toEqual({
      ...DEFAULT_CAPS,
      nativeTools: false,
      pricing: { inPerMTok: 1, outPerMTok: 2 },
    });
    expect(resolveCaps('m', { m: { pricing: { inPerMTok: 1 } as never } }).pricing).toEqual({
      inPerMTok: 1,
      outPerMTok: 0,
    });
  });

  it('has a built-in catalog', () => {
    expect(resolveCaps('gemma2').nativeTools).toBe(false);
    expect(Object.keys(BUILTIN_CATALOG).length).toBeGreaterThan(3);
  });

  it('loads a user models.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remy-'));
    const file = join(dir, 'models.json');
    writeFileSync(file, JSON.stringify({ x: { contextTokens: 1000 } }));
    expect(resolveCaps('x', loadCatalog(file)).contextTokens).toBe(1000);
    writeFileSync(file, '[]');
    expect(() => loadCatalog(file)).toThrow(/expected an object/);
  });
});
