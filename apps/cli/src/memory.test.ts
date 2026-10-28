import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelResponse } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { MEMORY_MAX_ENTRIES } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { openMemory, personaliseOn, plainMemory } from './memory.ts';
import { saveProfile } from './profile.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-mem-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const file = () => join(home, 'memory.json');
const input = (text: string, kind = 'preference' as const) => ({ text, kind, source: 'task_1' });

describe('memory store', () => {
  it('saves notes owner-only and reads them back newest first', () => {
    let t = 0;
    const m = openMemory(home, { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)) });
    expect(m.add(input('Likes tea'))).toMatchObject({ status: 'added' });
    m.add(input('Prefers metric units'));
    expect(m.list().map((e) => e.text)).toEqual(['Prefers metric units', 'Likes tea']);
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(openMemory(home).list()).toHaveLength(2);
    expect(m.list()[0]).toMatchObject({ kind: 'preference', source: 'task_1' });
    expect(m.list()[0]?.id).toMatch(/^mem_[0-9a-f]{6}$/);
  });

  it('does not save the same text twice, ignoring case and spacing', () => {
    const m = openMemory(home);
    const a = m.add(input('Likes  tea'));
    const b = m.add(input('likes tea'));
    expect(b).toMatchObject({ status: 'exists' });
    expect(a.status === 'added' && b.status === 'exists' && a.entry.id === b.entry.id).toBe(true);
    expect(m.list()).toHaveLength(1);
  });

  it('stops at the cap', () => {
    const m = openMemory(home);
    const entries = Array.from({ length: MEMORY_MAX_ENTRIES }, (_, i) => ({
      id: `mem_${i}`,
      text: `note ${i}`,
      kind: 'preference',
      source: '',
      created: '2026-01-01T00:00:00.000Z',
    }));
    writeFileSync(file(), JSON.stringify({ entries }));
    expect(m.add(input('one more'))).toEqual({ status: 'full' });
    expect(m.remove('mem_0')).toBe(true);
    expect(m.add(input('one more'))).toMatchObject({ status: 'added' });
  });

  it('removes, edits and clears, and tells subscribers', () => {
    const m = openMemory(home);
    let seen = 0;
    m.subscribe(() => (seen += 1));
    const a = m.add(input('Likes tea'));
    const id = a.status === 'added' ? a.entry.id : '';
    expect(m.edit(id, '  Likes\ncoffee  ')).toBe(true);
    expect(m.list()[0]?.text).toBe('Likes coffee');
    expect(m.edit('nope', 'x')).toBe(false);
    expect(m.edit(id, '   ')).toBe(false);
    expect(m.remove('nope')).toBe(false);
    m.add(input('Other'));
    expect(m.clear()).toBe(2);
    expect(m.list()).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  it('treats a damaged file as empty with a note, and moves it aside on the next save', () => {
    writeFileSync(file(), '{ not json');
    const m = openMemory(home);
    expect(m.load()).toMatchObject({ entries: [], damaged: true });
    expect(m.load().note).toContain('could not be read');
    m.add(input('Likes tea'));
    expect(readdirSync(home)).toContain('memory.json.damaged');
    expect(readFileSync(join(home, 'memory.json.damaged'), 'utf8')).toBe('{ not json');
    expect(m.list()).toHaveLength(1);
    writeFileSync(file(), JSON.stringify({ wrong: true }));
    expect(m.load().note).toContain('expected shape');
  });

  it('skips unreadable notes and keeps the rest', () => {
    writeFileSync(
      file(),
      JSON.stringify({
        entries: [
          { id: 'mem_a', text: 'Good note', kind: 'preference', source: '', created: '2026-01-01' },
          { id: 'mem_b', text: 'Bad kind', kind: 'secret' },
          'junk',
        ],
      }),
    );
    const m = openMemory(home);
    expect(m.load().entries).toHaveLength(1);
    expect(m.load().note).toContain('2 notes');
  });
});

describe('use follows the profile', () => {
  it('is on only with a profile that has personalising on', () => {
    expect(personaliseOn(home)).toBe(false);
    saveProfile(home, {
      name: '',
      goals: [],
      createdAt: new Date().toISOString(),
      personalise: true,
    });
    expect(personaliseOn(home)).toBe(true);
    saveProfile(home, {
      name: '',
      goals: [],
      createdAt: new Date().toISOString(),
      personalise: false,
    });
    expect(personaliseOn(home)).toBe(false);
  });

  it('prints a plain list, with a hint when notes are not in use', () => {
    const m = openMemory(home);
    expect(plainMemory(m.load(), true)).toContain('has not saved anything');
    m.add(input('Likes tea'));
    const text = plainMemory(m.load(), false);
    expect(text).toContain('remembers 1 thing about you');
    expect(text).toMatch(/mem_[0-9a-f]{6} {2}Likes tea {2}\(preference, \d{4}-\d{2}-\d{2}\)/);
    expect(text).toContain('Personalise replies');
    expect(text).not.toContain('!');
  });
});

const usage = { inTokens: 10, outTokens: 5 };
const finish: ModelResponse = { calls: [{ tool: 'finish', args: { answer: 'Done.' } }], usage };

function harness(model: ScriptedModelClient) {
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home },
    cwd: home,
    out: (s) => {
      o.out += s;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store: new MemoryEventStore(),
    model,
  };
  return {
    run: async (...argv: string[]) => {
      o.out = '';
      o.err = '';
      const code = await cli(argv, deps);
      return { code, ...o };
    },
  };
}

describe('the system prompt and tools', () => {
  const seed = () => {
    openMemory(home).add({ text: 'Wants answers in metric units', kind: 'preference', source: '' });
  };
  const on = (personalise: boolean) =>
    saveProfile(home, { name: '', goals: [], createdAt: new Date().toISOString(), personalise });

  it('carry the saved notes and the remember tool only with personalising on', async () => {
    seed();
    on(true);
    const model = new ScriptedModelClient([finish]);
    await harness(model).run('run', 'convert 3 cups to metric');
    const req = model.requests[0];
    expect(req?.system).toContain("The user's own saved notes");
    expect(req?.system).toContain('"Wants answers in metric units"');
    expect(req?.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['remember', 'forget']));
  });

  it('leave both out with personalising off or no profile', async () => {
    seed();
    for (const setup of [
      () => on(false),
      () => rmSync(join(home, 'profile.json'), { force: true }),
    ]) {
      setup();
      const model = new ScriptedModelClient([finish]);
      await harness(model).run('run', 'convert 3 cups to metric');
      const req = model.requests[0];
      expect(req?.system).not.toContain('saved notes');
      expect(req?.system).not.toContain('remember');
      expect(req?.tools.map((t) => t.name)).not.toContain('remember');
    }
  });

  it('save a note after approval, which the next task sees', async () => {
    on(true);
    const remember: ModelResponse = {
      calls: [{ tool: 'remember', args: { text: 'Prefers tea', kind: 'preference' } }],
      usage,
    };
    const first = harness(new ScriptedModelClient([remember, finish]));
    const r = await first.run('run', 'I always want tea');
    expect(r.out).toContain('Remember: Prefers tea');
    const id = /task_[0-9a-f]{12}/.exec(r.out)?.[0] as string;
    await first.run('approve', id);
    expect(openMemory(home).list()[0]).toMatchObject({ text: 'Prefers tea', source: id });
    const model = new ScriptedModelClient([finish]);
    await harness(model).run('run', 'which drink');
    expect(model.requests[0]?.system).toContain('Prefers tea');
  });
});

describe('remy memory', () => {
  it('lists, forgets one and clears', async () => {
    const m = openMemory(home);
    const a = m.add(input('Likes tea'));
    m.add(input('Likes cake'));
    const id = a.status === 'added' ? a.entry.id : '';
    const h = harness(new ScriptedModelClient([]));
    const list = await h.run('memory', 'list');
    expect(list.out).toContain('Likes tea');
    expect(list.out).toContain('remembers 2 things');
    expect((await h.run('memory')).out).toContain('Likes cake');
    expect((await h.run('memory', 'forget', id)).out).toContain(`Forgot ${id}.`);
    expect(
      openMemory(home)
        .list()
        .map((e) => e.text),
    ).toEqual(['Likes cake']);
    expect((await h.run('memory', 'clear')).out).toContain('Forgot 1 note.');
    expect(openMemory(home).list()).toEqual([]);
    expect((await h.run('memory', 'clear')).out).toContain('nothing to forget');
  });

  it('says so for an unknown id or subcommand', async () => {
    const h = harness(new ScriptedModelClient([]));
    expect((await h.run('memory', 'forget', 'mem_zzz')).err).toContain('no saved note mem_zzz');
    expect((await h.run('memory', 'forget')).err).toContain('Usage');
    expect((await h.run('memory', 'wat')).err).toContain('Use remy memory');
  });
});
