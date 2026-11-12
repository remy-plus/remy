import { describe, expect, it } from 'vitest';
import { readerStatus, resolveReader } from './readers.ts';

const noKeychain = { platform: 'linux' as const };

describe('resolveReader', () => {
  it('prefers Firecrawl, then Cloudflare, else none', async () => {
    expect(
      (
        await resolveReader(
          { FIRECRAWL_API_KEY: 'a', CLOUDFLARE_ACCOUNT_ID: 'b', CLOUDFLARE_API_TOKEN: 'c' },
          noKeychain,
        )
      ).id,
    ).toBe('firecrawl');
    expect(
      (await resolveReader({ CLOUDFLARE_ACCOUNT_ID: 'b', CLOUDFLARE_API_TOKEN: 'c' }, noKeychain))
        .id,
    ).toBe('cloudflare');
    expect(
      (await resolveReader({ CLOUDFLARE_ACCOUNT_ID: 'b' }, noKeychain)).reader,
    ).toBeUndefined();
    expect((await resolveReader({}, noKeychain)).reader).toBeUndefined();
  });

  it('REMY_READER overrides', async () => {
    const all = { FIRECRAWL_API_KEY: 'a', CLOUDFLARE_ACCOUNT_ID: 'b', CLOUDFLARE_API_TOKEN: 'c' };
    expect(
      (await resolveReader({ ...all, REMY_READER: 'off' }, noKeychain)).reader,
    ).toBeUndefined();
    expect((await resolveReader({ ...all, REMY_READER: 'cloudflare' }, noKeychain)).id).toBe(
      'cloudflare',
    );
    const always = await resolveReader({ ...all, REMY_READER: 'always' }, noKeychain);
    expect([always.id, always.always]).toEqual(['firecrawl', true]);
    const missing = await resolveReader({ REMY_READER: 'firecrawl' }, noKeychain);
    expect(missing.reader).toBeUndefined();
    expect(missing.lines[0]).toContain('key is not set');
  });

  it('reads keys from the Keychain and reports them for redaction, never in the lines', async () => {
    const exec = async (_c: string, args: string[]) => ({
      status: 0,
      stdout: args.includes('firecrawl') ? 'fc-secret\n' : '',
    });
    const r = await resolveReader({}, { platform: 'darwin', exec });
    expect(r.id).toBe('firecrawl');
    expect(r.found).toEqual([{ name: 'FIRECRAWL_API_KEY', value: 'fc-secret' }]);
    expect(r.sources.firecrawl).toBe('keychain');
    expect(r.lines.join('\n')).not.toContain('fc-secret');
  });

  it('status says private addresses are never sent', async () => {
    const lines = await readerStatus({ FIRECRAWL_API_KEY: 'a' }, noKeychain);
    expect(lines[0]).toContain('Firecrawl');
    expect(lines[0]).toContain('never sent');
  });
});
