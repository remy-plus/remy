import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, TaskBusyError, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bgState,
  forwardedFlags,
  logPath,
  notifyTitle,
  readMarker,
  type SpawnOptions,
  spawnWorker,
  writeMarker,
} from './background.ts';
import { type CliDeps, cli } from './cli.ts';
import { appleScriptString, notificationFor, notify } from './notify.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-bg-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const usage = { inTokens: 100, outTokens: 20 };
const done = { calls: [{ tool: 'finish', args: { answer: 'All done.' } }], usage };
const write = { calls: [{ tool: 'write_file', args: { path: 'a.txt', content: 'x' } }], usage };
const entry = { execPath: '/node', execArgv: ['--conditions=@remy/source'], script: '/x/main.ts' };
const DEAD_PID = 0x7ffffffe;

interface Spawned {
  cmd: string;
  args: string[];
  opts: SpawnOptions;
}

function harness(extra: Partial<CliDeps> = {}, tee?: (s: string) => void) {
  const store = new MemoryEventStore();
  const spawned: Spawned[] = [];
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home, REMY_NOTIFY: 'off' },
    cwd: home,
    out: (s) => {
      o.out += s;
      tee?.(s);
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store,
    entry,
    spawner: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return { pid: 4242, unref() {} };
    },
    ...extra,
  };
  const run = async (...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, deps);
    return { code, out: o.out, err: o.err };
  };
  /** Starts a background task and says its worker is this process (so it counts as alive). */
  const startBg = async (prompt: string, pid = process.pid) => {
    const id = idOf((await run('run', '--background', prompt)).out);
    writeMarker(home, id, { pid, startedAt: 'now' });
    return id;
  };
  return { run, store, deps, spawned, o, startBg };
}
const idOf = (s: string) => /task_[0-9a-f]{12}/.exec(s)?.[0] as string;

describe('spawnWorker', () => {
  it('starts a detached `remy worker <id>` with output in the log and writes a marker', () => {
    const calls: Spawned[] = [];
    let unref = false;
    const r = spawnWorker({
      home,
      id: 'task_a',
      cwd: home,
      env: { PATH: '/bin' },
      entry,
      extraArgs: ['--model', 'm'],
      spawner: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return {
          pid: 77,
          unref() {
            unref = true;
          },
        };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('/node');
    expect(calls[0]?.args).toEqual([
      '--conditions=@remy/source',
      '/x/main.ts',
      'worker',
      'task_a',
      '--model',
      'm',
    ]);
    expect(calls[0]?.opts.detached).toBe(true);
    expect(calls[0]?.opts.stdio[0]).toBe('ignore');
    expect(calls[0]?.opts.env.REMY_HOME).toBe(home);
    expect(unref).toBe(true);
    expect(r.log).toBe(logPath(home, 'task_a'));
    expect(existsSync(r.log)).toBe(true);
    expect(statSync(r.log).mode & 0o077).toBe(0);
    expect(readMarker(home, 'task_a')?.pid).toBe(77);
  });

  it('fails clearly when no process id comes back', () => {
    expect(() =>
      spawnWorker({
        home,
        id: 'task_b',
        cwd: home,
        env: {},
        entry,
        spawner: () => ({ unref() {} }),
      }),
    ).toThrow(/did not start/);
  });

  it('forwards only the model flags', () => {
    expect(forwardedFlags({ profile: 'groq', model: 'm', 'base-url': 'http://x' })).toEqual([
      '--profile',
      'groq',
      '--model',
      'm',
      '--base-url',
      'http://x',
    ]);
    expect(forwardedFlags({})).toEqual([]);
  });
});

describe('states', () => {
  it('maps log status and worker liveness', () => {
    expect(bgState('running', true)).toBe('running');
    expect(bgState('running', false)).toBe('stopped');
    expect(bgState('waiting_approval', false)).toBe('waiting for you');
    expect(bgState('waiting_user', false)).toBe('waiting for you');
    expect(bgState('paused', false)).toBe('paused');
    expect(bgState('succeeded', false)).toBe('done');
    expect(bgState('failed', false)).toBe('done');
  });
});

describe('notifications', () => {
  it('escapes quotes, backslashes and control characters', () => {
    expect(appleScriptString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c d"');
  });

  it('uses the truncated prompt and fixed phrases only', () => {
    const n = notificationFor({
      status: 'succeeded',
      id: 'task_1',
      prompt: `Summarise ${'x'.repeat(100)}`,
    });
    expect(n?.body.length).toBeLessThan(120);
    expect(n?.body).toContain('remy show task_1');
    expect(notificationFor({ status: 'paused', id: 't', prompt: 'p' })?.body).toContain(
      'remy continue t',
    );
    expect(notificationFor({ status: 'waiting_approval', id: 't', prompt: 'p' })?.body).toContain(
      'remy attach t',
    );
    expect(notificationFor({ status: 'cancelled', id: 't', prompt: 'p' })).toBeUndefined();
    expect(notifyTitle('a\nb\u0007c')).toBe('a b c');
  });

  it('runs osascript text on macOS and nowhere else', () => {
    const ran: string[] = [];
    const note = { title: 'T "q"', body: 'B' };
    expect(notify(note, { env: {}, platform: 'darwin', run: (s) => ran.push(s) })).toBe(true);
    expect(ran[0]).toBe('display notification "B" with title "T \\"q\\""');
    expect(notify(note, { env: {}, platform: 'linux', run: (s) => ran.push(s) })).toBe(false);
    expect(ran).toHaveLength(1);
  });

  it('REMY_NOTIFY=off sends nothing', () => {
    const ran: string[] = [];
    const sent = notify(
      { title: 't', body: 'b' },
      { env: { REMY_NOTIFY: 'off' }, platform: 'darwin', run: (s) => ran.push(s) },
    );
    expect(sent).toBe(false);
    expect(ran).toEqual([]);
  });
});

describe('remy run --background', () => {
  it('creates the task, spawns the worker and returns without running the model', async () => {
    const h = harness({ model: new ScriptedModelClient([done]) });
    const r = await h.run('run', '--background', '--long', 'write a report');
    expect(r.code).toBe(0);
    const id = idOf(r.out);
    expect(r.out).toContain(`remy attach ${id}`);
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]?.args.slice(0, 4)).toEqual([
      '--conditions=@remy/source',
      '/x/main.ts',
      'worker',
      id,
    ]);
    const events = await h.store.read(id);
    expect(events.map((e) => e.event.type)).toEqual(['task.created']);
    expect(JSON.stringify(events[0])).toContain('"maxSteps":200');
    expect(readMarker(home, id)?.pid).toBe(4242);
  });
});

describe('remy worker', () => {
  it('drives the task to the end and notifies', async () => {
    const ran: string[] = [];
    const h = harness({
      model: new ScriptedModelClient([done]),
      platform: 'darwin',
      env: { REMY_HOME: home },
      notifyRun: (s) => ran.push(s),
    });
    const id = idOf((await h.run('run', '--background', 'say hi')).out);
    const r = await h.run('worker', id);
    expect(r.code).toBe(0);
    expect(r.out).toContain('All done.');
    expect((await h.store.listTasks())[0]?.status).toBe('succeeded');
    expect(ran).toHaveLength(1);
    expect(ran[0]).toContain('say hi');
    expect(ran[0]).toContain(`remy show ${id}`);
    // The lease is free again.
    expect(await h.store.acquireLease(id, 'someone', 1000)).not.toBeNull();
  });

  it('is quiet with REMY_NOTIFY=off and stops at an approval', async () => {
    const ran: string[] = [];
    const h = harness({
      model: new ScriptedModelClient([write, done]),
      platform: 'darwin',
      notifyRun: (s) => ran.push(s),
    });
    const id = idOf((await h.run('run', '--background', 'write a file')).out);
    const r = await h.run('worker', id);
    expect(r.out).toContain('Approval needed:');
    expect((await h.store.listTasks())[0]?.status).toBe('waiting_approval');
    expect(ran).toEqual([]);
  });

  it('notifies when it needs you', async () => {
    const ran: string[] = [];
    const h = harness({
      model: new ScriptedModelClient([write, done]),
      platform: 'darwin',
      env: { REMY_HOME: home },
      notifyRun: (s) => ran.push(s),
    });
    const id = idOf((await h.run('run', '--background', 'write a file')).out);
    await h.run('worker', id);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toContain('waiting for approval');
    expect(ran[0]).toContain(`remy attach ${id}`);
  });
});

describe('leases keep two runners apart', () => {
  it('a foreground runner is refused while a worker holds the task, and fine after', async () => {
    const h = harness({ model: new ScriptedModelClient([done]) });
    const id = idOf((await h.run('run', '--background', 'say hi')).out);
    const worker = await h.store.acquireLease(id, 'worker', 60_000);
    expect(worker).not.toBeNull();
    const rt = createRuntime({
      store: h.store,
      model: new ScriptedModelClient([done]),
      tools: new ToolRegistry([]),
      owner: 'foreground',
      capabilities: () => ({}) as never,
    });
    await expect(rt.advance(id)).rejects.toBeInstanceOf(TaskBusyError);
    if (worker) await h.store.releaseLease(worker);
    expect(await h.store.acquireLease(id, 'foreground', 60_000)).not.toBeNull();
  });
});

describe('remy list', () => {
  it('marks background tasks and their state', async () => {
    const h = harness({ model: new ScriptedModelClient([done]) });
    const alive = await h.startBg('one');
    const dead = await h.startBg('two', DEAD_PID);
    const plain = idOf((await h.run('run', 'three')).out);
    const r = await h.run('list');
    const line = (id: string) => r.out.split('\n').find((l) => l.includes(id)) ?? '';
    expect(line(alive)).toContain('bg running');
    expect(line(dead)).toContain('bg stopped');
    expect(line(plain)).not.toContain('bg ');
  });
});

describe('remy attach', () => {
  it('prints a finished task and returns', async () => {
    const h = harness({ model: new ScriptedModelClient([done]) });
    const id = idOf((await h.run('run', 'say hi')).out);
    const r = await h.run('attach', id);
    expect(r.code).toBe(0);
    expect(r.out).toContain('All done.');
    expect(r.out).toContain(`remy show ${id}`);
  });

  it('follows the log and ends when the worker finishes', async () => {
    let out = '';
    const h = harness({ model: new ScriptedModelClient([done]) }, (s) => {
      out += s;
    });
    const id = await h.startBg('say hi');
    let polls = 0;
    h.deps.sleep = async () => {
      polls++;
      if (polls === 1) await cli(['worker', id], { ...h.deps, out: () => {} });
    };
    out = '';
    const code = await cli(['attach', id], h.deps);
    expect(code).toBe(0);
    expect(polls).toBeGreaterThanOrEqual(1);
    expect(out).toContain('All done.');
  });

  it('Ctrl+C detaches and says the task keeps running', async () => {
    let out = '';
    let handler: (() => Promise<void>) | undefined;
    const h = harness(
      {
        model: new ScriptedModelClient([done]),
        onInterrupt: (fn) => {
          handler = fn;
          return () => {};
        },
      },
      (s) => {
        out += s;
      },
    );
    const id = await h.startBg('say hi');
    let polls = 0;
    h.deps.sleep = async () => {
      polls++;
      if (polls === 1) {
        await handler?.();
        await cli(['worker', id], { ...h.deps, out: () => {}, onInterrupt: undefined });
      }
    };
    out = '';
    await cli(['attach', id], h.deps);
    expect(out).toContain(`Detached. ${id} keeps running`);
    expect(out).not.toContain('Stopped.');
  });

  it('off a terminal, a task that waits for you names the command', async () => {
    const h = harness({ model: new ScriptedModelClient([write, done]) });
    const id = idOf((await h.run('run', 'write a file')).out);
    const r = await h.run('attach', id);
    expect(r.out).toContain('Waiting for you');
    expect(r.out).toContain(`remy attach ${id}`);
  });

  it('on a terminal, a waiting task is asked about inline and finished', async () => {
    const answers = ['y'];
    const h = harness({
      model: new ScriptedModelClient([write, done]),
      ask: async () => answers.shift() ?? null,
    });
    const id = idOf((await h.run('run', '--background', 'write a file')).out);
    await h.run('worker', id);
    h.deps.isTTY = true;
    const r = await h.run('attach', id);
    expect(r.out).toContain('Approval needed:');
    expect(r.out).toContain('All done.');
  });

  it('says so when no worker is running a task', async () => {
    const h = harness({ model: new ScriptedModelClient([done]), sleep: async () => {} });
    const id = await h.startBg('say hi', DEAD_PID);
    const r = await h.run('attach', id);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`remy resume ${id}`);
  });
});
