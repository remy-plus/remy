import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelResponse } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';

const usage = { inTokens: 100, outTokens: 20 };
const call = (tool: string, args: unknown): ModelResponse => ({
  calls: [{ tool, args }],
  usage,
});
const write = call('write_file', { path: 'a.txt', content: 'hello' });
const done = call('finish', { answer: 'Wrote a.txt.' });

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-cli-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function harness(extra: Partial<CliDeps> = {}) {
  const store = new MemoryEventStore();
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
    store,
    ...extra,
  };
  const run = async (...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, deps);
    return { code, out: o.out, err: o.err };
  };
  return { run, store, deps };
}

const taskIdOf = (out: string) => /task_[0-9a-f]{12}/.exec(out)?.[0] as string;

describe('remy run', () => {
  it('pauses for approval when not on a terminal and prints the follow-up commands', async () => {
    const model = new ScriptedModelClient([write, done]);
    const h = harness({ model });
    const r = await h.run('run', 'write a file');
    expect(r.code).toBe(0);
    const id = taskIdOf(r.out);
    expect(r.out).toContain('Approval needed:');
    expect(r.out).toContain('Risk: write');
    expect(r.out).toContain(`remy approve ${id}`);
    expect(r.out).toContain(`remy approve ${id} --deny`);
    expect(r.out).not.toContain('!');
    expect(r.out).not.toContain('\x1b[');
  });

  it('approve resumes the task and finishes it', async () => {
    const model = new ScriptedModelClient([write, done]);
    const h = harness({ model });
    const id = taskIdOf((await h.run('run', 'write a file')).out);
    const r = await h.run('approve', id);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Wrote a.txt.');
    expect(r.out).toContain(`remy show ${id}`);
    const file = join(home, 'workspaces', id, 'a.txt');
    expect(readFileSync(file, 'utf8')).toBe('hello');
  });

  it('asks inline on a terminal and continues after y', async () => {
    const answers = ['y'];
    const asked: string[] = [];
    const h = harness({
      model: new ScriptedModelClient([write, done]),
      isTTY: true,
      ask: async (q) => {
        asked.push(q);
        return answers.shift() ?? null;
      },
    });
    const r = await h.run('run', 'write a file');
    expect(r.code).toBe(0);
    expect(asked).toEqual(['Approve? [y/N] ']);
    expect(r.out).toContain('Approval needed:');
    expect(r.out).toContain('Wrote a.txt.');
  });

  it('denying on a terminal lets the model adapt', async () => {
    const h = harness({
      model: new ScriptedModelClient([write, call('finish', { answer: 'Skipped the file.' })]),
      isTTY: true,
      ask: async () => 'n',
    });
    const r = await h.run('run', 'write a file');
    expect(r.out).toContain('denied write_file');
    expect(r.out).toContain('Skipped the file.');
  });

  it('answers questions through remy answer', async () => {
    const model = new ScriptedModelClient([call('ask_user', { question: 'Which folder?' }), done]);
    const h = harness({ model });
    const first = await h.run('run', 'sort my files');
    const id = taskIdOf(first.out);
    expect(first.out).toContain('Question: Which folder?');
    expect(first.out).toContain(`remy answer ${id}`);
    const r = await h.run('answer', id, 'Downloads');
    expect(r.out).toContain('Wrote a.txt.');
  });

  it('auto-approves what --auto allows', async () => {
    const h = harness({ model: new ScriptedModelClient([write, done]) });
    const r = await h.run('run', 'write a file', '--auto', 'read,write');
    expect(r.out).not.toContain('Approval needed');
    expect(r.out).toContain('Wrote a.txt.');
  });

  it('uses the color palette only on a terminal and honors NO_COLOR', async () => {
    const mk = (env: Record<string, string>) =>
      harness({
        env: { REMY_HOME: home, ...env },
        isTTY: true,
        ask: async () => null,
        model: new ScriptedModelClient([write]),
      });
    expect((await mk({ COLORTERM: 'truecolor' }).run('run', 'x')).out).toContain(
      '\x1b[38;2;140;138;133m',
    );
    expect((await mk({}).run('run', 'x')).out).toContain('\x1b[90m');
    expect((await mk({ NO_COLOR: '1' }).run('run', 'x')).out).not.toContain('\x1b[');
  });

  it('fails with a clear message when no model is configured', async () => {
    const h = harness();
    const r = await h.run('run', 'hello');
    expect(r.code).toBe(1);
    expect(r.err).toContain('REMY_PROFILE');
    expect(r.err).toContain('REMY_MODEL');
    expect(r.err.trim().split('\n')).toHaveLength(1);
  });

  it('names the API key variable a profile needs', async () => {
    const h = harness({ env: { REMY_HOME: home, REMY_PROFILE: 'openrouter', REMY_MODEL: 'm' } });
    const r = await h.run('run', 'hello');
    expect(r.code).toBe(1);
    expect(r.err).toContain('OPENROUTER_API_KEY');
  });

  it('reads the model from remy.config.json when env and flags are silent', async () => {
    const h = harness();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, 'remy.config.json'), JSON.stringify({ profile: 'ollama' }));
    const r = await h.run('run', 'hello');
    expect(r.err).toContain('REMY_MODEL');
    expect(r.err).not.toContain('REMY_PROFILE');
  });
});

describe('inspecting tasks', () => {
  async function finished() {
    const h = harness({ model: new ScriptedModelClient([write, done]) });
    const id = taskIdOf((await h.run('run', 'write a file', '--auto', 'read,write')).out);
    return { h, id };
  }

  it('show prints a readable timeline with totals', async () => {
    const { h, id } = await finished();
    const r = await h.run('show', id);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Task ${id}  succeeded`);
    expect(r.out).toContain('step 1  write_file');
    expect(r.out).toContain('path=a.txt');
    expect(r.out).toContain('2 steps, 200 in, 40 out');
    expect(r.out).toContain('Wrote a.txt.');
  });

  it('show --json prints one event per line', async () => {
    const { h, id } = await finished();
    const r = await h.run('show', id, '--json');
    const lines = r.out
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0].event.type).toBe('task.created');
    expect(lines.at(-1).event.type).toBe('task.finished');
    expect(lines.every((l) => l.taskId === id)).toBe(true);
  });

  it('show reports an unknown task in one line', async () => {
    const r = await harness().run('show', 'task_nope');
    expect(r.code).toBe(1);
    expect(r.err).toContain('No task named task_nope');
  });

  it('list shows tasks and filters by status', async () => {
    const { h, id } = await finished();
    expect((await h.run('list')).out).toContain(id);
    expect((await h.run('list', '--status', 'succeeded')).out).toContain(id);
    expect((await h.run('list', '--status', 'failed')).out).toContain('No failed tasks.');
    expect((await h.run('list', '--status', 'bogus')).code).toBe(1);
  });

  it('list on an empty store points to remy run', async () => {
    expect((await harness().run('list')).out).toContain('remy run');
  });
});

describe('remy cancel', () => {
  it('cancels a paused task and does not need a model', async () => {
    const h = harness({ model: new ScriptedModelClient([write]) });
    const id = taskIdOf((await h.run('run', 'write a file')).out);
    const bare = harness({ store: h.store });
    const r = await bare.run('cancel', id);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Cancelled ${id}.`);
    expect((await h.run('list', '--status', 'cancelled')).out).toContain(id);
    expect((await bare.run('cancel', id)).out).toContain('already cancelled');
  });
});

describe('misc', () => {
  it('prints the version and help', async () => {
    const h = harness();
    expect((await h.run('--version')).out).toMatch(/^remy \d+\.\d+\.\d+/);
    expect((await h.run('help')).out).toContain('remy run');
    expect((await h.run()).out).toContain('Usage');
  });

  it('rejects unknown commands in one line', async () => {
    const r = await harness().run('dance');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Unknown command');
  });
});
