import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fold, type ModelResponse } from '@remy/core';
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
    expect(asked).toEqual(['Approve? [y/N/a] ']);
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

  it('approve --deny --note records the note with the denial', async () => {
    const model = new ScriptedModelClient([write, call('finish', { answer: 'Skipped it.' })]);
    const h = harness({ model });
    const id = taskIdOf((await h.run('run', 'write a file')).out);
    const r = await h.run('approve', id, '--deny', '--note', 'use b.txt instead');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Skipped it.');
    const stored = await h.store.read(id);
    const resolved = stored.map((e) => e.event).find((e) => e.type === 'approval.resolved');
    expect(resolved).toMatchObject({ granted: false, note: 'use b.txt instead' });
    // The model reads the note as the result of the denied call.
    const result = Object.values(fold(stored).calls).find((c) => c.tool === 'write_file')?.result;
    expect(JSON.stringify(result)).toContain('declined this action and said: use b.txt instead');
  });

  describe('standing approvals', () => {
    const remove = call('delete_file', { path: 'a.txt' });
    const allowedFile = () => JSON.parse(readFileSync(join(home, 'approvals.json'), 'utf8'));

    it('approve --always saves the tool, and the next task skips the approval', async () => {
      const h = harness({ model: new ScriptedModelClient([write, done, write, done]) });
      const id = taskIdOf((await h.run('run', 'write a file')).out);
      const r = await h.run('approve', id, '--always');
      expect(r.code).toBe(0);
      expect(r.out).toContain('Always allowing write_file. Undo: remy approvals remove write_file');
      expect(Object.keys(allowedFile().alwaysAllow)).toEqual(['write_file']);
      // A new task: no card, the call is allowed by the standing approval and says so.
      const second = await h.run('run', 'write it again');
      expect(second.out).not.toContain('Approval needed:');
      expect(second.out).toContain('Wrote a.txt.');
      const events = (await h.store.read(taskIdOf(second.out))).map((e) => e.event);
      expect(events.some((e) => e.type === 'approval.requested')).toBe(false);
      expect(events.find((e) => e.type === 'policy.decided')).toMatchObject({
        decision: { kind: 'allow', via: 'standing' },
      });
      const shown = await h.run('show', taskIdOf(second.out));
      expect(shown.out).toContain('you always allow write_file');
    });

    it('approve --always refuses an irreversible action and leaves the approval waiting', async () => {
      const h = harness({ model: new ScriptedModelClient([remove, done]) });
      const id = taskIdOf((await h.run('run', 'delete a file')).out);
      expect(await h.run('approve', id, '--always')).toMatchObject({
        code: 1,
        err: expect.stringMatching(/cannot be undone/),
      });
      expect((await h.store.read(id)).some((e) => e.event.type === 'approval.resolved')).toBe(
        false,
      );
    });

    it('refuses --always with --deny', async () => {
      const h = harness({ model: new ScriptedModelClient([write, done]) });
      const id = taskIdOf((await h.run('run', 'write a file')).out);
      expect(await h.run('approve', id, '--always', '--deny')).toMatchObject({
        code: 1,
        err: expect.stringMatching(/cannot go together/),
      });
    });

    it('offers a on a terminal for writes only, and saves it', async () => {
      const asked: string[] = [];
      const answers = ['a'];
      const h = harness({
        model: new ScriptedModelClient([write, done]),
        isTTY: true,
        ask: async (q) => {
          asked.push(q);
          return answers.shift() ?? null;
        },
      });
      const r = await h.run('run', 'write a file');
      expect(r.out).toContain('a approves and always allows write_file');
      expect(asked).toEqual(['Approve? [y/N/a] ']);
      expect(Object.keys(allowedFile().alwaysAllow)).toEqual(['write_file']);
      const d = harness({
        model: new ScriptedModelClient([remove, call('finish', { answer: 'Kept it.' })]),
        isTTY: true,
        ask: async (q) => {
          asked.push(q);
          return 'a'; // "a" is not an answer here: it counts as no
        },
      });
      await d.run('run', 'delete a file');
      expect(asked.at(-1)).toBe('Approve? [y/N] ');
      expect(Object.keys(allowedFile().alwaysAllow)).toEqual(['write_file']);
    });

    it('ignores a hand-edited entry for an irreversible tool', async () => {
      writeFileSync(
        join(home, 'approvals.json'),
        JSON.stringify({ alwaysAllow: { delete_file: {}, write_file: {} } }),
      );
      const h = harness({ model: new ScriptedModelClient([remove, done]) });
      const r = await h.run('run', 'delete a file');
      expect(r.out).toContain('Approval needed:');
    });

    it('a damaged file turns standing approvals off with one note', async () => {
      writeFileSync(join(home, 'approvals.json'), '{nope');
      const h = harness({ model: new ScriptedModelClient([write, done]) });
      const r = await h.run('run', 'write a file');
      expect(r.out).toContain('Approval needed:');
      expect(r.err).toContain('approvals.json could not be read');
    });

    it('remy approvals lists and removes', async () => {
      const h = harness({ model: new ScriptedModelClient([]) });
      expect((await h.run('approvals')).out).toContain('Nothing is allowed for good');
      writeFileSync(
        join(home, 'approvals.json'),
        JSON.stringify({ alwaysAllow: { write_file: {}, delete_file: {} } }),
      );
      const list = (await h.run('approvals', 'list')).out;
      expect(list).toContain('write_file');
      expect(list).toContain('delete_file (ignored: this tool always asks)');
      expect((await h.run('approvals', 'remove', 'write_file')).out).toContain('asks again');
      expect(await h.run('approvals', 'remove', 'write_file')).toMatchObject({
        code: 1,
        err: expect.stringMatching(/not on the list/),
      });
      expect(await h.run('approvals', 'nonsense')).toMatchObject({
        code: 1,
        err: expect.stringMatching(/remy approvals list/),
      });
    });
  });

  it('refuses --note without --deny', async () => {
    const h = harness({ model: new ScriptedModelClient([write, done]) });
    const id = taskIdOf((await h.run('run', 'write a file')).out);
    const r = await h.run('approve', id, '--note', 'hm');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--note goes with --deny');
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
    expect(r.err).toContain('remy login');
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
    writeFileSync(
      join(home, 'remy.config.json'),
      JSON.stringify({ baseUrl: 'http://localhost:9/v1' }),
    );
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
    expect((await h.run('help')).out).toContain('--minimal');
    expect((await h.run('help')).out).not.toContain('--classic');
    expect((await h.run()).out).toContain('Usage');
  });

  it('rejects unknown commands in one line', async () => {
    const r = await harness().run('dance');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Unknown command');
  });
});

describe('--debug', () => {
  it('writes model calls and events as JSON lines to stderr, and leaves stdout alone', async () => {
    const plain = await harness({ model: new ScriptedModelClient([done]) }).run('run', 'x');
    const r = await harness({ model: new ScriptedModelClient([done]) }).run('run', 'x', '--debug');
    const kinds = r.err
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as { kind: string }).kind);
    expect(kinds).toEqual(expect.arrayContaining(['model.request', 'model.response', 'event']));
    const norm = (t: string) => t.replace(/task_\w+/g, 'T').replace(/\d+ms/g, 'Nms');
    expect(norm(r.out)).toBe(norm(plain.out));
  });

  it('REMY_DEBUG=<path> writes to that file instead', async () => {
    const path = join(home, 'trace.jsonl');
    const h = harness({
      env: { REMY_HOME: home, REMY_DEBUG: path },
      model: new ScriptedModelClient([done]),
    });
    const r = await h.run('run', 'x');
    expect(r.err).toBe(`Debug log: ${path}\n`);
    expect(readFileSync(path, 'utf8')).toContain('"kind":"model.request"');
  });

  it('prints help instead of opening the chat when not on a terminal', async () => {
    const r = await harness({ isTTY: false }).run();
    expect(r.out).toContain('Open the chat');
    expect(r.out).toContain('--debug');
  });
});

describe('long runs', () => {
  const read2 = (n: number) => call('write_file', { path: `f${n}.txt`, content: 'x' });
  const auto = ['--auto', 'read,write', '--max-steps', '1'];

  it('prints the continue command when a run pauses off a terminal', async () => {
    const h = harness({ model: new ScriptedModelClient([read2(1), done]) });
    const r = await h.run('run', 'two files', ...auto);
    const id = taskIdOf(r.out);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Paused after 1 step and $0.00.');
    expect(r.out).toContain(`remy continue ${id}`);
    expect(r.out).not.toContain('Failed');
    expect(r.out).not.toContain('!');
  });

  it('continue gives the original budget again and finishes', async () => {
    const h = harness({ model: new ScriptedModelClient([read2(1), done]) });
    const id = taskIdOf((await h.run('run', 'two files', ...auto)).out);
    const r = await h.run('continue', id);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Continuing');
    expect(r.out).toContain('Wrote a.txt.');
    const s = fold(await h.store.read(id));
    expect(s.config.budget.maxSteps).toBe(2);
  });

  it('continue --steps and --cost set exactly what is added', async () => {
    const h = harness({ model: new ScriptedModelClient([read2(1), done]) });
    const id = taskIdOf((await h.run('run', 'two files', ...auto)).out);
    await h.run('continue', id, '--steps', '5', '--cost', '2');
    const s = fold(await h.store.read(id));
    expect(s.config.budget.maxSteps).toBe(6);
    expect(s.config.budget.maxCostUsd).toBe(3);
  });

  it('continue rejects bad numbers and tasks that are not paused', async () => {
    const h = harness({ model: new ScriptedModelClient([write, done]) });
    const id = taskIdOf((await h.run('run', 'write a file')).out);
    expect((await h.run('continue', id)).err).toContain('is not paused');
    expect((await h.run('continue', id, '--steps', 'zero')).err).toContain(
      '--steps must be a positive number',
    );
    expect((await h.run('continue')).err).toContain('Usage: remy continue');
  });

  it('asks on a terminal and continues after y', async () => {
    const asked: string[] = [];
    const h = harness({
      model: new ScriptedModelClient([read2(1), done]),
      isTTY: true,
      ask: async (q) => {
        asked.push(q);
        return 'y';
      },
    });
    const r = await h.run('run', 'two files', ...auto);
    expect(asked).toEqual(['Paused after 1 step and $0.00. Continue for 1 more steps? [y/N] ']);
    expect(r.out).toContain('Wrote a.txt.');
  });

  it('leaves the task paused on a terminal when the answer is not y', async () => {
    const h = harness({
      model: new ScriptedModelClient([read2(1), done]),
      isTTY: true,
      ask: async () => '',
    });
    const r = await h.run('run', 'two files', ...auto);
    expect(r.out).toContain('remy continue');
    expect(fold(await h.store.read(taskIdOf(r.out))).status).toBe('paused');
  });

  it('--long sets 200 steps, $5 and 4 hours', async () => {
    const h = harness({ model: new ScriptedModelClient([done]) });
    const id = taskIdOf((await h.run('run', 'quick', '--long')).out);
    const b = fold(await h.store.read(id)).config.budget;
    expect([b.maxSteps, b.maxCostUsd, b.maxWallMs]).toEqual([200, 5, 4 * 60 * 60_000]);
  });

  it('show lists the pause and the extension', async () => {
    const h = harness({ model: new ScriptedModelClient([read2(1), done]) });
    const id = taskIdOf((await h.run('run', 'two files', ...auto)).out);
    await h.run('continue', id);
    const r = await h.run('show', id);
    expect(r.out).toContain('paused at the steps limit after 1 steps');
    expect(r.out).toContain('continued by user');
  });
});
