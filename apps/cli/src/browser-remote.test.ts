import { describe, expect, it } from 'vitest';
import { resolveRemoteBrowser } from './browser-remote.ts';

const keys =
  (m: Record<string, string>) =>
  (env: string): string | undefined =>
    m[env];

describe('resolveRemoteBrowser', () => {
  it('stays local by default', () => {
    expect(resolveRemoteBrowser({}, keys({}))).toEqual({ kind: 'local' });
    expect(resolveRemoteBrowser({ REMY_BROWSER: 'local' }, keys({}))).toEqual({ kind: 'local' });
  });

  it('names the variable when the key is missing, and never falls back', () => {
    const r = resolveRemoteBrowser({ REMY_BROWSER: 'steel' }, keys({}));
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toContain('STEEL_API_KEY');
    const b = resolveRemoteBrowser(
      { REMY_BROWSER: 'browserbase' },
      keys({ BROWSERBASE_API_KEY: 'k' }),
    );
    expect(b.kind === 'error' && b.message).toContain('BROWSERBASE_PROJECT_ID');
  });

  it('rejects an unknown name', () => {
    expect(resolveRemoteBrowser({ REMY_BROWSER: 'x' }, keys({})).kind).toBe('error');
  });

  it('builds both providers', () => {
    const s = resolveRemoteBrowser({ REMY_BROWSER: 'Steel' }, keys({ STEEL_API_KEY: 'sk-1234' }));
    expect(s.kind === 'remote' && s.provider.id).toBe('steel');
    const b = resolveRemoteBrowser(
      { REMY_BROWSER: 'browserbase' },
      keys({ BROWSERBASE_API_KEY: 'bb-1234', BROWSERBASE_PROJECT_ID: 'p-1' }),
    );
    expect(b.kind === 'remote' && b.secrets).toEqual(['bb-1234', 'p-1']);
  });
});
