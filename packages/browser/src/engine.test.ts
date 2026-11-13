import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createLightpandaProvider,
  type EngineProcess,
  freeLoopbackPort,
  LIGHTPANDA_NO_WINDOW,
  lightpandaArgs,
  lightpandaPath,
  resolveEngine,
} from './engine.ts';

describe('resolveEngine', () => {
  const exists = (yes: boolean) => () => yes;

  it('keeps Chrome when unset, empty or chrome', () => {
    expect(resolveEngine({})).toEqual({ kind: 'chrome' });
    expect(resolveEngine({ REMY_BROWSER_ENGINE: ' ' })).toEqual({ kind: 'chrome' });
    expect(resolveEngine({ REMY_BROWSER_ENGINE: 'Chrome' })).toEqual({ kind: 'chrome' });
  });

  it('picks Lightpanda from the engines folder when it is there', () => {
    const r = resolveEngine(
      { REMY_BROWSER_ENGINE: 'lightpanda' },
      { home: '/h', exists: exists(true) },
    );
    expect(r).toEqual({ kind: 'lightpanda', path: '/h/.remy/engines/lightpanda' });
    expect(lightpandaPath('/h')).toBe('/h/.remy/engines/lightpanda');
  });

  it('takes a path from REMY_LIGHTPANDA_PATH', () => {
    const r = resolveEngine(
      { REMY_BROWSER_ENGINE: 'lightpanda', REMY_LIGHTPANDA_PATH: '/x/lp' },
      { exists: exists(true) },
    );
    expect(r).toEqual({ kind: 'lightpanda', path: '/x/lp' });
  });

  it('says how to get the program when it is missing, and does not pick it', () => {
    const r = resolveEngine(
      { REMY_BROWSER_ENGINE: 'lightpanda' },
      { home: '/h', exists: exists(false) },
    );
    expect(r.kind).toBe('missing');
    if (r.kind === 'missing') {
      expect(r.message).toContain('/h/.remy/engines/lightpanda');
      expect(r.message).toContain('github.com/lightpanda-io/browser/releases');
    }
  });

  it('refuses an engine it does not know', () => {
    const r = resolveEngine({ REMY_BROWSER_ENGINE: 'firefox' });
    expect(r.kind).toBe('error');
  });
});

describe('lightpandaArgs', () => {
  it('binds loopback only and blocks private networks unless allowed', () => {
    expect(lightpandaArgs(9333)).toEqual([
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '9333',
      '--block-private-networks',
    ]);
    expect(lightpandaArgs(9333, true)).not.toContain('--block-private-networks');
    expect(lightpandaArgs(9333, true)).toContain('127.0.0.1');
  });
});

function fakeChild() {
  const ee = new EventEmitter();
  const stderr = new EventEmitter();
  const kills: (string | undefined)[] = [];
  let dieOnTerm = true;
  const child = {
    pid: 4242,
    kill: (sig?: NodeJS.Signals) => {
      kills.push(sig);
      if (sig === 'SIGKILL' || dieOnTerm) queueMicrotask(() => ee.emit('exit', null));
      return true;
    },
    on: (e: string, cb: (...a: never[]) => void) => ee.on(e, cb as never),
    stderr,
  } as unknown as EngineProcess;
  return {
    child,
    kills,
    ee,
    stderr,
    ignoreTerm: () => {
      dieOnTerm = false;
    },
  };
}

describe('Lightpanda process lifecycle', () => {
  it('starts on a free loopback port, waits until it answers, and stops it on close', async () => {
    const f = fakeChild();
    const spawn = vi.fn(() => f.child);
    let calls = 0;
    const p = createLightpandaProvider({
      binary: '/b/lp',
      spawn,
      freePort: async () => 45555,
      ready: async () => ++calls >= 3,
      env: { PATH: '/bin' },
    });
    expect(p.notice).toContain('no saved logins');
    expect(p.noWindow).toBe(LIGHTPANDA_NO_WINDOW);
    const s = await p.createSession();
    expect(s.cdpUrl).toBe('ws://127.0.0.1:45555/');
    expect(calls).toBe(3);
    expect(spawn).toHaveBeenCalledOnce();
    const [bin, args, env] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, string>,
    ];
    expect(bin).toBe('/b/lp');
    expect(args).toContain('127.0.0.1');
    expect(args).toContain('45555');
    expect(env.LIGHTPANDA_DISABLE_TELEMETRY).toBe('true');
    await s.close();
    expect(f.kills).toEqual(['SIGTERM']);
    await s.close(); // closing twice does nothing more
    expect(f.kills).toEqual(['SIGTERM']);
  });

  it('kills outright when it ignores a polite stop', async () => {
    const f = fakeChild();
    f.ignoreTerm();
    const p = createLightpandaProvider({
      binary: '/b/lp',
      spawn: () => f.child,
      freePort: async () => 45556,
      ready: async () => true,
      killAfterMs: 30,
    });
    const s = await p.createSession();
    await s.close();
    expect(f.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('reports a program that stops at once, with its last line', async () => {
    const f = fakeChild();
    const p = createLightpandaProvider({
      binary: '/b/lp',
      spawn: () => {
        queueMicrotask(() => {
          f.stderr.emit('data', 'boot\nbad flag');
          f.ee.emit('exit', 1);
        });
        return f.child;
      },
      freePort: async () => 45557,
      ready: async () => false,
    });
    await expect(p.createSession()).rejects.toThrow(
      'Lightpanda did not start: it stopped at once: bad flag',
    );
  });

  it('reports a program that cannot be run, and one that never answers (and stops it)', async () => {
    const a = fakeChild();
    const broken = createLightpandaProvider({
      binary: '/b/lp',
      spawn: () => {
        queueMicrotask(() => a.ee.emit('error', new Error('spawn EACCES')));
        return a.child;
      },
      freePort: async () => 1,
      ready: async () => false,
    });
    await expect(broken.createSession()).rejects.toThrow('spawn EACCES');

    const b = fakeChild();
    const slow = createLightpandaProvider({
      binary: '/b/lp',
      spawn: () => b.child,
      freePort: async () => 2,
      ready: async () => false,
      startTimeoutMs: 120,
    });
    await expect(slow.createSession()).rejects.toThrow('did not answer in time');
    expect(b.kills).toContain('SIGTERM');
  });

  it('gives a free port on loopback', async () => {
    const port = await freeLoopbackPort();
    expect(port).toBeGreaterThan(0);
  });
});

describe.skipIf(process.env.REMY_TEST_LIGHTPANDA !== '1')('real Lightpanda', () => {
  it('starts, answers CDP version and stops', async () => {
    const choice = resolveEngine({ REMY_BROWSER_ENGINE: 'lightpanda' });
    if (choice.kind !== 'lightpanda') throw new Error('no Lightpanda program installed');
    const s = await createLightpandaProvider({ binary: choice.path }).createSession();
    try {
      const url = new URL(s.cdpUrl);
      expect(url.hostname).toBe('127.0.0.1');
      const r = await fetch(`http://${url.host}/json/version`);
      expect(((await r.json()) as { Browser: string }).Browser).toMatch(/Lightpanda/);
    } finally {
      await s.close();
    }
    await expect(fetch(`http://${new URL(s.cdpUrl).host}/json/version`)).rejects.toThrow();
  });
});
