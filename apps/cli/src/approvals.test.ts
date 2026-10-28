import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApprovals, plainApprovals, standingBlocker } from './approvals.ts';

const home = () => mkdtempSync(join(tmpdir(), 'remy-approvals-'));
const at = new Date('2026-10-28T10:00:00Z');

describe('standing approvals file', () => {
  it('starts empty, adds, lists and removes, privately', () => {
    const h = home();
    const s = openApprovals(h, () => at);
    expect(s.load()).toEqual({ entries: [] });
    s.add('write_file', 'write');
    s.add('write_file', 'write'); // no duplicate
    s.add('github__create_issue', 'send_as_user');
    expect(s.names()).toEqual(['write_file', 'github__create_issue']);
    expect(s.load().entries[0]).toEqual({ tool: 'write_file', since: at.toISOString() });
    expect(statSync(join(h, 'approvals.json')).mode & 0o777).toBe(0o600);
    expect(s.remove('write_file')).toBe(true);
    expect(s.remove('write_file')).toBe(false);
    expect(s.names()).toEqual(['github__create_issue']);
    // A new store reads the same file.
    expect(openApprovals(h).names()).toEqual(['github__create_issue']);
  });

  it('refuses spend_money, irreversible and read', () => {
    const s = openApprovals(home());
    for (const risk of ['spend_money', 'irreversible', 'read'] as const)
      expect(() => s.add('t', risk)).toThrow();
    expect(s.names()).toEqual([]);
    expect(standingBlocker('pay', 'spend_money')).toMatch(/spends money/);
    expect(standingBlocker('rm', 'irreversible')).toMatch(/cannot be undone/);
    expect(standingBlocker('w', 'write')).toBeUndefined();
  });

  it('treats a damaged file as empty with a note, and moves it aside on the next save', () => {
    const h = home();
    const path = join(h, 'approvals.json');
    writeFileSync(path, '{not json');
    const s = openApprovals(h);
    const cur = s.load();
    expect(cur.entries).toEqual([]);
    expect(cur.note).toMatch(/could not be read.*Fix or delete/);
    s.add('write_file', 'write');
    expect(readFileSync(`${path}.damaged`, 'utf8')).toBe('{not json');
    expect(s.names()).toEqual(['write_file']);
  });

  it('skips unreadable entries and wrong shapes', () => {
    const h = home();
    const path = join(h, 'approvals.json');
    writeFileSync(path, JSON.stringify({ alwaysAllow: { ok: { since: 'x' }, bad: { since: 5 } } }));
    const cur = openApprovals(h).load();
    expect(cur.entries.map((e) => e.tool)).toEqual(['ok']);
    expect(cur.note).toMatch(/1 entry .* skipped/);
    writeFileSync(path, JSON.stringify(['write_file']));
    expect(openApprovals(h).load()).toMatchObject({ entries: [], damaged: true });
  });

  it('lists in plain words and flags entries that are ignored', () => {
    const h = home();
    writeFileSync(
      join(h, 'approvals.json'),
      JSON.stringify({
        alwaysAllow: { write_file: { since: '2026-10-28T10:00:00Z' }, delete_file: {} },
      }),
    );
    const text = plainApprovals(openApprovals(h).load(), (t) =>
      t === 'delete_file' ? 'irreversible' : 'write',
    );
    expect(text).toContain('write_file  since 2026-10-28');
    expect(text).toContain('delete_file (ignored: this tool always asks)');
    expect(plainApprovals({ entries: [] }, () => undefined)).toMatch(/Nothing is allowed for good/);
  });
});
