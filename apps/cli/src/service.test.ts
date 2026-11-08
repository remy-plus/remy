import { describe, expect, it } from 'vitest';
import { launchAgentPlist } from './daemon.ts';
import { installerFor, type RunResult, type ServiceContext } from './service.ts';

/** A context that records every command and file and starts nothing. */
export function fake(over: { fail?: (cmd: string, args: string[]) => RunResult | undefined } = {}) {
  const commands: string[][] = [];
  const written: Record<string, string> = {};
  const removed: string[] = [];
  const ctx: ServiceContext = {
    entry: { execPath: '/usr/bin/node', execArgv: [], script: '/x/remy.js' },
    homeDir: '/Users/a',
    logFile: '/Users/a/.remy/logs/daemon.log',
    path: '/opt/bin',
    run: (cmd, args) => {
      commands.push([cmd, ...args]);
      return over.fail?.(cmd, args) ?? { status: 0, stdout: '' };
    },
    files: {
      write: (p, t) => {
        written[p] = t;
      },
      remove: (p) => {
        removed.push(p);
      },
    },
  };
  return { ctx, commands, written, removed };
}

describe('launchd installer', () => {
  const plistPath = '/Users/a/Library/LaunchAgents/plus.remy.daemon.plist';

  it('is the one chosen on macOS and nowhere unknown', () => {
    expect(installerFor('darwin', fake().ctx)?.kind).toBe('launchd');
    expect(installerFor('freebsd', fake().ctx)).toBeUndefined();
  });

  it('writes the LaunchAgent and loads it', () => {
    const f = fake();
    expect(installerFor('darwin', f.ctx)?.install()).toBe(
      'The daemon is on and starts when you log in.',
    );
    expect(f.written[plistPath]).toBe(launchAgentPlist(f.ctx.entry, f.ctx.logFile, '/opt/bin'));
    expect(f.commands).toEqual([
      ['launchctl', 'unload', plistPath],
      ['launchctl', 'load', '-w', plistPath],
    ]);
  });

  it('says so when macOS will not load it', () => {
    const f = fake({ fail: (_c, a) => (a[0] === 'load' ? { status: 1 } : undefined) });
    expect(() => installerFor('darwin', f.ctx)?.install()).toThrow(
      'macOS did not start the daemon.',
    );
  });

  it('unloads and removes the file', () => {
    const f = fake();
    expect(installerFor('darwin', f.ctx)?.uninstall()).toBe('The daemon is off.');
    expect(f.commands).toEqual([['launchctl', 'unload', '-w', plistPath]]);
    expect(f.removed).toEqual([plistPath]);
  });

  it('reads status from launchctl list', () => {
    const on = fake();
    expect(installerFor('darwin', on.ctx)?.status().message).toBe('The daemon is on.');
    expect(on.commands[0]).toEqual(['launchctl', 'list', 'plus.remy.daemon']);
    const off = fake({ fail: () => ({ status: 113 }) });
    expect(installerFor('darwin', off.ctx)?.status()).toEqual({
      on: false,
      message: 'The daemon is off. Turn it on with remy daemon install.',
    });
  });
});
