import { describe, expect, it } from 'vitest';
import {
  dockerRunArgs,
  type Run,
  startVm,
  stopVm,
  vmSearch,
  vmStatus,
  waitForVm,
} from './search-vm.ts';

const hit = (title: string) => ({ title, url: 'https://example.com/a', snippet: '' });
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('vmSearch', () => {
  const conn = { url: 'http://127.0.0.1:1', token: 't0k' };

  it('sends the token and takes the first engine with useful hits', async () => {
    const asked: string[] = [];
    const provider = vmSearch(conn, async (url, init) => {
      asked.push(`${url} ${(init?.headers as Record<string, string> | undefined)?.authorization}`);
      return reply({ hits: String(url).includes('ddg') ? [hit('Best Buy')] : [hit('rye bread')] });
    });
    expect(await provider.search('rye bread', 3)).toEqual([hit('rye bread')]);
    expect(asked[0]).toContain('engine=ddg');
    expect(asked[0]).toContain('Bearer t0k');
    expect(asked[1]).toContain('engine=bing');
  });

  it('moves on when an engine shows a bot check', async () => {
    const provider = vmSearch(conn, async (url) =>
      reply({ hits: String(url).includes('ddg') ? null : [hit('rye bread')] }),
    );
    expect(await provider.search('rye bread', 3)).toEqual([hit('rye bread')]);
  });

  it('says how to start it when it is not running', async () => {
    const provider = vmSearch(conn, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(provider.search('rye bread', 3)).rejects.toThrow('remy browser vm start');
  });

  it('starts the container once when it is not running', async () => {
    let up = false;
    let starts = 0;
    const provider = vmSearch(
      () => conn,
      async () => {
        if (!up) throw new TypeError('fetch failed');
        return reply({ hits: [hit('rye bread')] });
      },
      async () => {
        starts++;
        up = true;
        return true;
      },
    );
    expect(await provider.search('rye bread', 3)).toHaveLength(1);
    expect(starts).toBe(1);
  });

  it('says how to start it when starting by itself fails', async () => {
    const provider = vmSearch(
      conn,
      async () => {
        throw new TypeError('fetch failed');
      },
      async () => false,
    );
    await expect(provider.search('rye bread', 3)).rejects.toThrow('remy browser vm start');
  });

  it('caps the results', async () => {
    const provider = vmSearch(conn, async () =>
      reply({ hits: [hit('rye bread 1'), hit('rye bread 2')] }),
    );
    expect(await provider.search('rye bread', 1)).toHaveLength(1);
  });
});

describe('dockerRunArgs', () => {
  const args = dockerRunArgs({ port: 4000, token: 'abc', script: 'x' });

  it('publishes the port to this machine only', () => {
    expect(args.join(' ')).toContain('-p 127.0.0.1:4000:8080');
  });

  it('never mounts anything from the host', () => {
    expect(args).not.toContain('-v');
    expect(args).not.toContain('--mount');
  });

  it('removes itself and limits memory', () => {
    expect(args).toContain('--rm');
    expect(args.join(' ')).toContain('--memory 2g');
  });
});

describe('the container', () => {
  const docker = (running: boolean, up = true): { run: Run; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      run: (cmd, args) => {
        calls.push(`${cmd} ${args[0]}`);
        if (cmd === 'docker' && args[0] === 'info') return { ok: up, out: '' };
        if (cmd === 'docker' && args[0] === 'ps')
          return { ok: true, out: running ? 'remy-search' : '' };
        return { ok: true, out: '' };
      },
    };
  };

  it('reports when it is off', () => {
    expect(vmStatus(docker(false).run)).toBe('stopped');
    expect(vmStatus(docker(true).run)).toBe('running');
    expect(vmStatus(docker(false, false).run)).toBe('no-docker');
  });

  it('starts once, and not again when it is running', () => {
    const on = docker(true);
    expect(startVm(on.run, { port: 1, token: 't', script: 'x' })).toBe('already-running');
    expect(on.calls).not.toContain('docker run');
    const off = docker(false);
    expect(startVm(off.run, { port: 1, token: 't', script: 'x' })).toBe('started');
    expect(off.calls).toContain('docker run');
  });

  it('asks for Docker when there is none', () => {
    const none = docker(false, false);
    none.run = (
      (orig) => (cmd, args) =>
        cmd === 'colima' ? { ok: false, out: '' } : orig(cmd, args)
    )(none.run);
    expect(startVm(none.run, { port: 1, token: 't', script: 'x' })).toBe('no-docker');
  });

  it('stops the container', () => {
    const on = docker(true);
    stopVm(on.run);
    expect(on.calls).toContain('docker stop');
  });
});

describe('waitForVm', () => {
  const conn = { url: 'http://127.0.0.1:1', token: 't' };

  it('returns once the container answers', async () => {
    let n = 0;
    const ready = await waitForVm(
      conn,
      async () => {
        if (++n < 3) throw new TypeError('fetch failed');
        return reply({ ok: true });
      },
      async () => {},
    );
    expect([ready, n]).toEqual([true, 3]);
  });

  it('gives up after the last try', async () => {
    const ready = await waitForVm(
      conn,
      async () => reply({}, 500),
      async () => {},
      2,
    );
    expect(ready).toBe(false);
  });
});
