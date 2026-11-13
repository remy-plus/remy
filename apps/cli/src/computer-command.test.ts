import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComputerConfig, Exec } from '@remy/tools';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ComputerCommandContext,
  computerCommand,
  parseSshTarget,
} from './computer-command.ts';

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'remy-computer-')), 'remy.config.json');
});

const saved = (): ComputerConfig[] => JSON.parse(readFileSync(path, 'utf8')).computers;

function ctx(rest: string[], over: Partial<ComputerCommandContext> = {}) {
  const lines: string[] = [];
  const c: ComputerCommandContext = {
    rest,
    flags: {},
    list: () => {
      try {
        return saved() ?? [];
      } catch {
        return [];
      }
    },
    configPath: path,
    out: (s) => lines.push(s),
    ...over,
  };
  return { c, text: () => lines.join('') };
}

describe('parseSshTarget', () => {
  it.each([
    ['me@host', { user: 'me', host: 'host' }],
    ['me@10.0.0.5:2222', { user: 'me', host: '10.0.0.5', port: 2222 }],
  ])('reads %s', (v, want) => expect(parseSshTarget(v)).toEqual(want));
  it.each(['host', 'me@', '@h', 'me@h:0', 'me@h:70000', '-o@h', 'me@h x'])('refuses %s', (v) =>
    expect(parseSshTarget(v)).toBeNull(),
  );
});

describe('remy computer', () => {
  it('lists nothing, then adds a docker image, keeping other config keys', async () => {
    const first = ctx(['list']);
    expect(await computerCommand(first.c)).toBe(0);
    expect(first.text()).toContain('No machines yet');
    writeFileSync(path, JSON.stringify({ model: 'm' }));
    const add = ctx(['add', 'box'], { flags: { docker: 'debian:stable-slim' } });
    expect(await computerCommand(add.c)).toBe(0);
    expect(add.text()).toBe(
      'Added box: docker container remy-computer-box (debian:stable-slim). Check it with remy computer test box.\n',
    );
    expect(JSON.parse(readFileSync(path, 'utf8')).model).toBe('m');
    expect(saved()).toEqual([{ kind: 'docker', name: 'box', image: 'debian:stable-slim' }]);
    const list = ctx(['list']);
    await computerCommand(list.c);
    expect(list.text()).toBe('box: docker container remy-computer-box (debian:stable-slim)\n');
  });

  it('adds a running container, a network-less image and an ssh host', async () => {
    await computerCommand(ctx(['add', 'a'], { flags: { container: 'my-web' } }).c);
    await computerCommand(ctx(['add', 'b'], { flags: { docker: 'alpine', network: 'none' } }).c);
    await computerCommand(
      ctx(['add', 'c'], { flags: { ssh: 'me@10.0.0.5:2222', key: '/k/id' } }).c,
    );
    expect(saved()).toEqual([
      { kind: 'docker', name: 'a', container: 'my-web' },
      { kind: 'docker', name: 'b', image: 'alpine', network: 'none' },
      { name: 'c', user: 'me', host: '10.0.0.5', port: 2222, keyPath: '/k/id' },
    ]);
  });

  it.each([
    [['add'], {}, /Usage/],
    [['add', 'x'], {}, /Choose one of/],
    [['add', 'x'], { docker: 'a', ssh: 'u@h' }, /Choose one of/],
    [['add', 'x'], { docker: '-v/:/h' }, /Invalid image/],
    [['add', 'x'], { container: '--privileged' }, /Invalid container/],
    [['add', 'x'], { ssh: 'nope' }, /not user@host/],
    [['add', 'x'], { docker: 'a', key: '/k' }, /--key goes with --ssh/],
    [['add', 'x'], { ssh: 'u@h', network: 'none' }, /--network goes with --docker/],
    [['add', 'x'], { docker: 'a', network: 'host' }, /bridge or none/],
    [['test', 'ghost'], {}, /There is no machine named ghost/],
    [['rm', 'ghost'], {}, /There is no machine named ghost/],
    [['frob'], {}, /Usage/],
    [['list', 'a', 'b'], {}, /Usage/],
  ])('refuses %j %j', async (rest, flags, why) => {
    await expect(computerCommand(ctx(rest, { flags }).c)).rejects.toThrow(why);
  });

  it('will not add a name twice', async () => {
    await computerCommand(ctx(['add', 'box'], { flags: { docker: 'alpine' } }).c);
    await expect(
      computerCommand(ctx(['add', 'box'], { flags: { docker: 'alpine' } }).c),
    ).rejects.toThrow(/already a machine named box/);
  });

  it('tests a machine by running uname -a, with no model', async () => {
    await computerCommand(ctx(['add', 'box'], { flags: { docker: 'alpine' } }).c);
    const seen: string[][] = [];
    const exec: Exec = async (_f, args) => {
      seen.push(args);
      return args[0] === 'inspect'
        ? { exitCode: 0, stdout: 'true\n', stderr: '' }
        : { exitCode: 0, stdout: 'Linux box 6.1 aarch64\n', stderr: '' };
    };
    const t = ctx(['test', 'box'], { exec });
    expect(await computerCommand(t.c)).toBe(0);
    expect(t.text()).toBe(
      'Testing box (docker container remy-computer-box (alpine)).\nLinux box 6.1 aarch64\nbox works.\n',
    );
    expect(seen.at(-1)).toEqual(['exec', '-i', 'remy-computer-box', 'sh', '-c', 'uname -a']);
  });

  it('shows a failing test and a timeout plainly', async () => {
    await computerCommand(ctx(['add', 'box'], { flags: { docker: 'alpine' } }).c);
    const bad = ctx(['test', 'box'], {
      exec: async (_f, a) =>
        a[0] === 'inspect'
          ? { exitCode: 0, stdout: 'true', stderr: '' }
          : { exitCode: 2, stdout: '', stderr: 'oops\n' },
    });
    expect(await computerCommand(bad.c)).toBe(1);
    expect(bad.text()).toContain('box answered with exit code 2.\noops\n');
    const slow = ctx(['test', 'box'], {
      exec: async (_f, a) =>
        a[0] === 'inspect'
          ? { exitCode: 0, stdout: 'true', stderr: '' }
          : { exitCode: 255, stdout: '', stderr: '', timedOut: true },
    });
    await expect(computerCommand(slow.c)).rejects.toThrow('box did not answer in time.');
  });

  it('says Docker is not running instead of a stack trace', async () => {
    await computerCommand(ctx(['add', 'box'], { flags: { docker: 'alpine' } }).c);
    const t = ctx(['test', 'box'], {
      exec: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
      }),
    });
    await expect(computerCommand(t.c)).rejects.toThrow(
      'Docker is not running. Start Docker Desktop or `colima start`, then try again.',
    );
  });

  it('removes a machine and says what stays behind', async () => {
    await computerCommand(ctx(['add', 'box'], { flags: { docker: 'alpine' } }).c);
    await computerCommand(ctx(['add', 'web'], { flags: { container: 'w' } }).c);
    const rm = ctx(['rm', 'box']);
    await computerCommand(rm.c);
    expect(rm.text()).toContain('docker rm -f remy-computer-box');
    expect(saved().map((x) => x.name)).toEqual(['web']);
    const rm2 = ctx(['rm', 'web']);
    await computerCommand(rm2.c);
    expect(rm2.text()).not.toContain('docker rm');
    expect(saved()).toEqual([]);
  });
});

describe('remy computer add --boat', () => {
  it('saves a boat entry and says it needs the persons own key', async () => {
    const add = ctx(['add', 'cloud'], { flags: { boat: true, size: 'small' } });
    expect(await computerCommand(add.c)).toBe(0);
    expect(saved()).toEqual([{ kind: 'boat', name: 'cloud', size: 'small' }]);
    expect(add.text()).toContain('Boat cloud computer remy-cloud (small, EU)');
    expect(add.text()).toContain('remy search key boat');
    expect(add.text()).toContain('costs money after its 7-day trial');
  });

  it('refuses a region, a bad size, or mixing with another kind', async () => {
    await expect(
      computerCommand(ctx(['add', 'c'], { flags: { boat: true, region: 'eu' } }).c),
    ).rejects.toThrow(/EU regions only/);
    await expect(
      computerCommand(ctx(['add', 'c'], { flags: { boat: true, size: 'huge' } }).c),
    ).rejects.toThrow(/--size is one of/);
    await expect(
      computerCommand(ctx(['add', 'c'], { flags: { boat: true, docker: 'x' } }).c),
    ).rejects.toThrow(/Choose one of/);
    await expect(
      computerCommand(ctx(['add', 'c'], { flags: { docker: 'debian', size: 'small' } }).c),
    ).rejects.toThrow(/--size goes with --boat/);
  });

  it('lists a boat machine and rm says the Boat computer is not deleted', async () => {
    await computerCommand(ctx(['add', 'cloud'], { flags: { boat: true } }).c);
    const ls = ctx(['list']);
    await computerCommand(ls.c);
    expect(ls.text()).toBe('cloud: Boat cloud computer remy-cloud (default, EU)\n');
    const rm = ctx(['rm', 'cloud']);
    await computerCommand(rm.c);
    expect(rm.text()).toContain('does not delete the Boat computer');
    expect(saved()).toEqual([]);
  });

  it('test with no key explains how to add one and runs nothing', async () => {
    await computerCommand(ctx(['add', 'cloud'], { flags: { boat: true } }).c);
    const t = ctx(['test', 'cloud'], { boat: { getKey: async () => undefined } });
    await expect(computerCommand(t.c)).rejects.toThrow(/remy search key boat/);
  });
});
