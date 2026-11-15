import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_VISIT_MS, openLastSeen } from './last-seen.ts';

const home = () => mkdtempSync(join(tmpdir(), 'remy-seen-'));
const now = new Date('2026-11-14T12:00:00Z');

describe('last seen', () => {
  it('reads as 24 hours ago the first time', () => {
    expect(openLastSeen(home()).get(now).getTime()).toBe(now.getTime() - FIRST_VISIT_MS);
  });

  it('keeps the time it was told, owner-only', () => {
    const h = home();
    const seen = openLastSeen(h);
    seen.touch(new Date('2026-11-14T09:00:00Z'));
    expect(openLastSeen(h).get(now).toISOString()).toBe('2026-11-14T09:00:00.000Z');
    expect(statSync(join(h, 'last-seen.json')).mode & 0o777).toBe(0o600);
  });

  it('never moves back', () => {
    const h = home();
    const seen = openLastSeen(h);
    seen.touch(new Date('2026-11-14T09:00:00Z'));
    seen.touch(new Date('2026-11-13T09:00:00Z'));
    expect(seen.get(now).toISOString()).toBe('2026-11-14T09:00:00.000Z');
  });

  it('treats a damaged file as no record, and a later visit repairs it', () => {
    const h = home();
    writeFileSync(join(h, 'last-seen.json'), '{nope');
    const seen = openLastSeen(h);
    expect(seen.get(now).getTime()).toBe(now.getTime() - FIRST_VISIT_MS);
    seen.touch(now);
    expect(JSON.parse(readFileSync(join(h, 'last-seen.json'), 'utf8'))).toEqual({
      at: now.toISOString(),
    });
  });

  it('creates the home folder when it is missing', () => {
    const h = join(home(), 'new');
    openLastSeen(h).touch(now);
    expect(openLastSeen(h).get().toISOString()).toBe(now.toISOString());
  });
});
