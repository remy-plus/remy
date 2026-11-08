import { describe, expect, it } from 'vitest';
import { launchAgentPlist } from './daemon.ts';
import { installerFor, type RunResult, type ServiceContext, systemdUnit } from './service.ts';

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

describe('systemdUnit', () => {
  it('writes the whole unit for a plain path', () => {
    expect(
      systemdUnit(
        { execPath: '/usr/bin/node', execArgv: [], script: '/opt/remy/remy.js' },
        '/usr/bin:/bin',
      ),
    ).toBe(
      [
        '[Unit]',
        'Description=Remy daemon: runs your schedules',
        'After=network-online.target',
        '',
        '[Service]',
        'Type=simple',
        'ExecStart="/usr/bin/node" "/opt/remy/remy.js" "daemon" "run"',
        'Environment="PATH=/usr/bin:/bin"',
        'Restart=on-failure',
        'RestartSec=5',
        '',
        '[Install]',
        'WantedBy=default.target',
        '',
      ].join('\n'),
    );
  });

  it('quotes a path with a space and keeps node flags', () => {
    const unit = systemdUnit({
      execPath: '/home/a b/.nvm/node',
      execArgv: ['--conditions=@remy/source'],
      script: '/home/a b/remy/main.ts',
    });
    expect(unit).toContain(
      'ExecStart="/home/a b/.nvm/node" "--conditions=@remy/source" "/home/a b/remy/main.ts" "daemon" "run"',
    );
    expect(unit).not.toContain('Environment=');
  });

  it('needs an absolute node path', () => {
    expect(() => systemdUnit({ execPath: 'node', execArgv: [], script: '/x' })).toThrow(
      'full path',
    );
  });
});
