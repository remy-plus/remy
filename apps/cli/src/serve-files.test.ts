// The files a task wrote: what is listed, what can be downloaded, and every way to ask for more.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUDGET, type Event, type StoredEvent } from '@remy/core';
import { afterEach, describe, expect, it } from 'vitest';
import { attachment, createFilesMount } from './serve-files.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';

let kit: Kit | undefined;
let base: string;
afterEach(async () => {
  await kit?.close();
  kit = undefined;
  if (base) rmSync(base, { recursive: true, force: true });
});

type Wrote = { tool: string; args: Record<string, unknown>; ok?: boolean };

/** A finished task whose model made these calls in `workspace`. */
function taskWith(workspace: string, calls: Wrote[]): StoredEvent[] {
  const events: Event[] = [
    {
      type: 'task.created',
      prompt: 'make a file',
      config: {
        model: 'm',
        permissions: { autoApprove: ['read'] },
        budget: DEFAULT_BUDGET,
        workspaceDir: workspace,
      },
    },
    {
      type: 'model.responded',
      step: 1,
      calls: calls.map((c, i) => ({
        callId: `c${i}`,
        tool: c.tool,
        args: c.args,
        argsHash: `h${i}`,
      })),
      usage: { inTokens: 1, outTokens: 1 },
      costUsd: 0,
      latencyMs: 1,
    },
    ...calls.map(
      (c, i): Event => ({
        type: 'tool.completed',
        callId: `c${i}`,
        latencyMs: 1,
        result:
          c.ok === false
            ? { ok: false, error: 'no', retryable: false, phase: 'before_effect' }
            : { ok: true, content: 'ok', trust: 'trusted' },
      }),
    ),
  ];
  return events.map((event, i) => ({
    taskId: 't_files',
    seq: i + 1,
    at: '2026-11-14T00:00:00.000Z',
    event,
  }));
}

async function start(calls: Wrote[], setup: (ws: string, outside: string) => void) {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'remy-files-')));
  const ws = join(base, 'ws');
  const outside = join(base, 'outside');
  mkdirSync(ws, { recursive: true });
  mkdirSync(outside, { recursive: true });
  setup(ws, outside);
  const events = taskWith(ws, calls);
  const store = { read: async (id: string) => (id === 't_files' ? events : []) };
  kit = await startKit(() => [createFilesMount({ store })]);
  return { kit, ws, outside };
}

const write = (path: string): Wrote => ({ tool: 'write_file', args: { path, content: 'x' } });
const download = (k: Kit, path: string) =>
  k.api(`/api/tasks/t_files/files/download?path=${encodeURIComponent(path)}`);

describe('files a task wrote', () => {
  it('lists them with a name and a size, and downloads one as an attachment', async () => {
    const { kit } = await start([write('groceries.txt'), write('notes/plan.md')], (ws) => {
      writeFileSync(join(ws, 'groceries.txt'), 'milk\neggs\nbread\n');
      mkdirSync(join(ws, 'notes'));
      writeFileSync(join(ws, 'notes', 'plan.md'), '# plan');
    });
    const list = await kit.api('/api/tasks/t_files/files');
    expect(list.status).toBe(200);
    expect(list.json.files).toEqual([
      { path: 'groceries.txt', name: 'groceries.txt', size: 16 },
      { path: 'notes/plan.md', name: 'plan.md', size: 6 },
    ]);
    const res = await fetch(`${kit.base}/api/tasks/t_files/files/download?path=groceries.txt`, {
      headers: { authorization: `Bearer ${kit.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      'attachment; filename="groceries.txt"',
    );
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(await res.text()).toBe('milk\neggs\nbread\n');
  });

  it('needs the bearer token, like every other route', async () => {
    const { kit } = await start([write('a.txt')], (ws) => writeFileSync(join(ws, 'a.txt'), 'a'));
    expect((await kit.api('/api/tasks/t_files/files', { token: null })).status).toBe(401);
    expect(
      (await kit.api('/api/tasks/t_files/files/download?path=a.txt', { token: null })).status,
    ).toBe(401);
    expect((await kit.api('/api/tasks/t_files/files', { token: 'wrong' })).status).toBe(401);
  });

  it('is refused for a page on another site and for a name the server does not answer on', async () => {
    const { kit } = await start([write('a.txt')], (ws) => writeFileSync(join(ws, 'a.txt'), 'a'));
    const cross = await fetch(`${kit.base}/api/tasks/t_files/files`, {
      headers: { authorization: `Bearer ${kit.token}`, origin: 'https://evil.example' },
    });
    expect(cross.status).toBe(403);
    const rebind = await new Promise<number>((done) => {
      const r = request(
        {
          host: '127.0.0.1',
          port: kit.serving.port,
          path: '/api/tasks/t_files/files',
          headers: { host: 'evil.example', authorization: `Bearer ${kit.token}` },
        },
        (res) => {
          res.resume();
          done(res.statusCode ?? 0);
        },
      );
      r.end();
    });
    expect(rebind).toBe(421);
  });

  it('answers 404 for a task that does not exist and 405 for anything but GET', async () => {
    const { kit } = await start([], () => {});
    expect((await kit.api('/api/tasks/t_nope/files')).status).toBe(404);
    expect((await kit.api('/api/tasks/t_files/files', { method: 'POST', body: {} })).status).toBe(
      405,
    );
  });

  it('lists only files that were written, still exist and did not fail', async () => {
    const { kit } = await start(
      [
        write('kept.txt'),
        write('deleted.txt'),
        { tool: 'write_file', args: { path: 'failed.txt', content: 'x' }, ok: false },
        { tool: 'move_file', args: { from: 'old.txt', to: 'moved.txt' } },
        { tool: 'read_file', args: { path: 'read-only.txt' } },
      ],
      (ws) => {
        for (const f of ['kept.txt', 'failed.txt', 'moved.txt', 'read-only.txt', 'unlisted.txt'])
          writeFileSync(join(ws, f), 'x');
      },
    );
    const names = (
      (await kit.api('/api/tasks/t_files/files')).json.files as { path: string }[]
    ).map((f) => f.path);
    expect(names).toEqual(['kept.txt', 'moved.txt']);
    expect((await download(kit, 'unlisted.txt')).status).toBe(404);
    expect((await download(kit, 'read-only.txt')).status).toBe(404);
    expect((await download(kit, 'deleted.txt')).status).toBe(404);
  });
});

describe('path attacks', () => {
  it('refuses .., absolute paths, backslashes, nul bytes and dotfiles', async () => {
    const { kit, outside } = await start(
      [write('ok.txt'), write('.env'), write('.git/config'), write('sub/.secret')],
      (ws, out) => {
        writeFileSync(join(ws, 'ok.txt'), 'ok');
        writeFileSync(join(ws, '.env'), 'KEY=1');
        mkdirSync(join(ws, '.git'));
        writeFileSync(join(ws, '.git', 'config'), 'x');
        mkdirSync(join(ws, 'sub'));
        writeFileSync(join(ws, 'sub', '.secret'), 'x');
        writeFileSync(join(out, 'passwd'), 'root');
      },
    );
    // None of the dotfiles is even listed.
    expect(
      ((await kit.api('/api/tasks/t_files/files')).json.files as { path: string }[]).map(
        (f) => f.path,
      ),
    ).toEqual(['ok.txt']);
    for (const bad of [
      '../outside/passwd',
      'sub/../../outside/passwd',
      '..',
      join(outside, 'passwd'),
      '/etc/passwd',
      'C:/Windows/win.ini',
      'ok.txt\\..\\x',
      'ok.txt\0.png',
      '.env',
      '.git/config',
      'sub/.secret',
      './.env',
      '',
    ]) {
      const r = await download(kit, bad);
      expect([400, 404], bad).toContain(r.status);
      expect(r.text).not.toContain('root');
      expect(r.text).not.toContain('KEY=1');
    }
    expect((await download(kit, 'ok.txt')).status).toBe(200);
  });

  it('never offers a path the model named outside the workspace', async () => {
    const { kit } = await start(
      [write('../outside/leak.txt'), write('/etc/hosts'), write('ok.txt')],
      (ws, out) => {
        writeFileSync(join(out, 'leak.txt'), 'secret');
        writeFileSync(join(ws, 'ok.txt'), 'ok');
      },
    );
    const files = (await kit.api('/api/tasks/t_files/files')).json.files as { path: string }[];
    expect(files.map((f) => f.path)).toEqual(['ok.txt']);
    expect((await download(kit, '../outside/leak.txt')).status).not.toBe(200);
  });

  it('refuses a symlink that leaves the workspace, for a file and for a folder', async () => {
    const { kit } = await start(
      [write('link.txt'), write('dir/inner.txt'), write('inside-link.txt'), write('real.txt')],
      (ws, out) => {
        writeFileSync(join(out, 'secret.txt'), 'top secret');
        mkdirSync(join(out, 'folder'));
        writeFileSync(join(out, 'folder', 'inner.txt'), 'top secret');
        symlinkSync(join(out, 'secret.txt'), join(ws, 'link.txt'));
        symlinkSync(join(out, 'folder'), join(ws, 'dir'));
        writeFileSync(join(ws, 'real.txt'), 'fine');
        symlinkSync(join(ws, 'real.txt'), join(ws, 'inside-link.txt'));
      },
    );
    const files = (await kit.api('/api/tasks/t_files/files')).json.files as { path: string }[];
    // A link that stays inside the workspace is just a file; the two that leave it are gone.
    expect(files.map((f) => f.path)).toEqual(['inside-link.txt', 'real.txt']);
    for (const p of ['link.txt', 'dir/inner.txt']) {
      const r = await download(kit, p);
      expect(r.status).toBe(404);
      expect(r.text).not.toContain('top secret');
    }
  });

  it('does not offer a folder, and not a file over the size cap', async () => {
    const { kit } = await start([write('folder')], (ws) => mkdirSync(join(ws, 'folder')));
    expect((await kit.api('/api/tasks/t_files/files')).json.files).toEqual([]);
    expect((await download(kit, 'folder')).status).toBe(404);
  });
});

describe('attachment', () => {
  it('survives quotes, accents and header tricks in a name', () => {
    expect(attachment('plan.md')).toBe(`attachment; filename="plan.md"; filename*=UTF-8''plan.md`);
    const odd = attachment('a"b\r\nSet-Cookie: x=é.txt');
    expect(odd).not.toMatch(/[\r\n]/);
    expect(odd).toContain("filename*=UTF-8''a%22b%0D%0ASet-Cookie%3A%20x%3D%C3%A9.txt");
  });
});
