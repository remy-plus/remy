import { describe, expect, it } from 'vitest';
import { launchAgentPlist } from './daemon.ts';
import {
  installerFor,
  type RunResult,
  type ServiceContext,
  schtasksCreateArgs,
  systemdUnit,
  taskCommand,
  windowsArg,
} from './service.ts';

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
    expect(installerFor('linux', fake().ctx)?.kind).toBe('systemd');
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

describe('systemd installer', () => {
  const unitPath = '/Users/a/.config/systemd/user/remy.service';
  const sys = (...a: string[]) => ['systemctl', '--user', ...a];

  it('writes the unit, reloads and enables it', () => {
    const f = fake();
    expect(installerFor('linux', f.ctx)?.install()).toContain('starts when you log in');
    expect(f.written[unitPath]).toBe(systemdUnit(f.ctx.entry, '/opt/bin'));
    expect(f.commands).toEqual([
      sys('show-environment'),
      sys('daemon-reload'),
      sys('enable', '--now', 'remy.service'),
    ]);
  });

  it('suggests linger and never runs it', () => {
    const f = fake();
    expect(installerFor('linux', f.ctx)?.install()).toContain('loginctl enable-linger');
    expect(f.commands.flat()).not.toContain('loginctl');
  });

  it('says so and prints the foreground command when systemd is not there', () => {
    const f = fake({ fail: () => ({ status: null }) });
    const entry = { execPath: '/opt/my node/node', execArgv: [], script: "/x/it's.js" };
    expect(() => installerFor('linux', { ...f.ctx, entry })?.install()).toThrow(
      "not available here (no systemctl, a container, or WSL without systemd).\nRun this in your own service or a terminal instead:\n  '/opt/my node/node' '/x/it'\\''s.js' daemon run",
    );
    expect(f.written).toEqual({});
  });

  it('says so when enable fails', () => {
    const f = fake({ fail: (_c, a) => (a[1] === 'enable' ? { status: 1 } : undefined) });
    expect(() => installerFor('linux', f.ctx)?.install()).toThrow(
      'systemd did not start the daemon',
    );
  });

  it('disables, removes and reloads', () => {
    const f = fake();
    expect(installerFor('linux', f.ctx)?.uninstall()).toBe('The daemon is off.');
    expect(f.commands).toEqual([sys('disable', '--now', 'remy.service'), sys('daemon-reload')]);
    expect(f.removed).toEqual([unitPath]);
  });

  it('reads status from is-active', () => {
    const on = fake({ fail: () => ({ status: 0, stdout: 'active\n' }) });
    expect(installerFor('linux', on.ctx)?.status().on).toBe(true);
    expect(on.commands[0]).toEqual(sys('is-active', 'remy.service'));
    const off = fake({ fail: () => ({ status: 3, stdout: 'inactive\n' }) });
    expect(installerFor('linux', off.ctx)?.status().on).toBe(false);
  });
});

describe('scheduled task string', () => {
  it('quotes only what needs it', () => {
    expect(windowsArg('C:\\node\\node.exe')).toBe('C:\\node\\node.exe');
    expect(windowsArg('C:\\Program Files\\nodejs\\node.exe')).toBe(
      '"C:\\Program Files\\nodejs\\node.exe"',
    );
    expect(windowsArg('')).toBe('""');
  });

  it('escapes quotes and the backslashes before them and at the end', () => {
    expect(windowsArg('a "b" c')).toBe('"a \\"b\\" c"');
    expect(windowsArg('C:\\my dir\\')).toBe('"C:\\my dir\\\\"');
    expect(windowsArg('x\\"y z')).toBe('"x\\\\\\"y z"');
  });

  it('builds the task command with a path that has a space', () => {
    const entry = {
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      execArgv: [],
      script: 'C:\\Users\\Ana Lopes\\remy\\remy.js',
    };
    expect(taskCommand(entry)).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ana Lopes\\remy\\remy.js" daemon run',
    );
    expect(schtasksCreateArgs(entry)).toEqual([
      '/Create',
      '/SC',
      'ONLOGON',
      '/TN',
      'RemyDaemon',
      '/TR',
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ana Lopes\\remy\\remy.js" daemon run',
      '/RL',
      'LIMITED',
      '/F',
    ]);
  });

  it('never elevates or names another account', () => {
    const args = schtasksCreateArgs({ execPath: 'node', execArgv: [], script: 'r.js' });
    expect(args).toContain('LIMITED');
    expect(args).not.toContain('/RU');
    expect(args).not.toContain('HIGHEST');
  });

  it('refuses a command longer than schtasks takes', () => {
    expect(() => taskCommand({ execPath: 'n', execArgv: [], script: 'x'.repeat(300) })).toThrow(
      '261',
    );
  });
});
