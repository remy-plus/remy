import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER_HINT, type ModelResponse, NO_SEARCH_HINT } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
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
    expect(statSync(join(home, 'remy.sqlite')).mode & 0o777).toBe(0o600);
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

  it('keeps every note, with no cap', () => {
    const m = openMemory(home);
    for (let i = 0; i < 300; i++) m.add(input(`Owns gadget number ${i * 11}x`));
    expect(m.list()).toHaveLength(300);
  });

  it('updates the old note for the same fact in other words', () => {
    const m = openMemory(home);
    m.add(input('Likes tea'));
    expect(m.add(input('Likes tea with milk'))).toMatchObject({ status: 'merged' });
    expect(m.list().map((e) => e.text)).toEqual(['Likes tea with milk']);
  });

  it('saves a contradiction beside the old note and flags both, until one goes', () => {
    const m = openMemory(home);
    const a = m.add({ text: 'Lives in Lisbon', kind: 'about_you', source: '' });
    const b = m.add({ text: 'Lives in Porto', kind: 'about_you', source: '' });
    const [ida, idb] = [a, b].map((r) => (r.status === 'exists' ? '' : r.entry.id)) as [
      string,
      string,
    ];
    expect(m.list().find((e) => e.id === ida)?.conflictsWith).toEqual([idb]);
    expect(m.list().find((e) => e.id === idb)?.conflictsWith).toEqual([ida]);
    expect(plainMemory(m.load(), true)).toContain('may contradict');
    m.remove(idb);
    expect(m.list()[0]?.conflictsWith).toBeUndefined();
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

  it('flags notes that clash when they are imported together', () => {
    const note = (id: string, text: string) => ({
      id,
      text,
      kind: 'about_you',
      source: '',
      created: '2026-01-01',
    });
    writeFileSync(
      file(),
      JSON.stringify({
        entries: [
          note('mem_a', 'Lives in Lisbon'),
          note('mem_b', 'Lives in Porto'),
          note('mem_c', 'Has a dog'),
        ],
      }),
    );
    const byId = new Map(
      openMemory(home)
        .list()
        .map((e) => [e.id, e.conflictsWith ?? []]),
    );
    expect(byId.get('mem_a')).toEqual(['mem_b']);
    expect(byId.get('mem_b')).toEqual(['mem_a']);
    expect(byId.get('mem_c')).toEqual([]);
  });

  it('imports the old memory.json once, keeps it renamed, and never deletes it', () => {
    const old = JSON.stringify({
      entries: [
        { id: 'mem_a', text: 'Likes tea', kind: 'preference', source: '', created: '2026-01-01' },
        {
          id: 'mem_b',
          text: 'Lives in Lisbon',
          kind: 'about_you',
          source: 't',
          created: '2026-01-02',
        },
      ],
    });
    writeFileSync(file(), old);
    const m = openMemory(home);
    expect(m.list().map((e) => e.id)).toEqual(['mem_b', 'mem_a']);
    expect(readdirSync(home)).not.toContain('memory.json');
    expect(readFileSync(join(home, 'memory.json.imported'), 'utf8')).toBe(old);
    m.remove('mem_a');
    // A second open does not bring the removed note back.
    expect(
      openMemory(home)
        .list()
        .map((e) => e.id),
    ).toEqual(['mem_b']);
    // A file restored later is imported again, and the earlier copy is kept.
    writeFileSync(file(), old);
    expect(openMemory(home).list()).toHaveLength(2);
    expect(readdirSync(home).filter((n) => n.startsWith('memory.json.imported'))).toHaveLength(2);
  });

  it('shows the same notes to two connections, with every write kept', () => {
    const a = openMemory(home);
    const b = openMemory(home);
    for (let i = 0; i < 40; i++) {
      (i % 2 ? a : b).add(input(`Owns gadget number ${i * 13}x`));
      expect(a.list()).toHaveLength(i + 1);
      expect(b.list()).toHaveLength(i + 1);
    }
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

function harness(model: ScriptedModelClient, env: Record<string, string> = {}) {
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home, ...env },
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
    // The notes go before the user's message; the system prompt only gets the fixed remember hint.
    expect(req?.system).toContain('Call remember only');
    expect(req?.system).not.toContain('saved notes');
    expect(req?.messages[0]?.content).toContain("The user's own saved notes");
    expect(req?.messages[0]?.content).toContain('"Wants answers in metric units"');
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
    expect(model.requests[0]?.messages[0]?.content).toContain('Prefers tea');
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

describe('web search', () => {
  it('searches and browses through the browser on this machine by default', async () => {
    const model = new ScriptedModelClient([finish]);
    await harness(model).run('run', 'find the best budget laptops');
    const req = model.requests[0];
    expect(req?.system).toContain(BROWSER_HINT);
    expect(req?.system).not.toContain(NO_SEARCH_HINT);
    expect(req?.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['web_search', 'browser_open', 'browser_act', 'browser_show']),
    );
  });

  it('keeps web_search with no route, so the model gets the one step instead of guessing', async () => {
    const model = new ScriptedModelClient([finish]);
    await harness(model, { REMY_BROWSER: 'off' }).run('run', 'find the best budget laptops');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('web_search');
  });

  it('leaves the hint out when a search key is set', async () => {
    const model = new ScriptedModelClient([finish]);
    await harness(model, { TAVILY_API_KEY: 'tvly-test' }).run('run', 'find laptops');
    expect(model.requests[0]?.system).not.toContain('Web search is not set up');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('web_search');
  });
});

describe('picking the search', () => {
  it('follows REMY_SEARCH over the browser, and turns search off', async () => {
    const ctx = new ScriptedModelClient([finish]);
    await harness(ctx, { REMY_SEARCH: 'context', CONTEXT_DEV_API_KEY: 'c' }).run('run', 'find rye');
    const names = ctx.requests[0]?.tools.map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('browser_open');
    const off = new ScriptedModelClient([finish]);
    await harness(off, { REMY_SEARCH: 'off' }).run('run', 'find rye');
    expect(off.requests[0]?.tools.map((t) => t.name)).not.toContain('web_search');
    expect(off.requests[0]?.system).toContain(NO_SEARCH_HINT);
  });
});
