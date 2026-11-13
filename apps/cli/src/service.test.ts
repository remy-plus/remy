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
    expect(installerFor('win32', fake().ctx)?.kind).toBe('schtasks');
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
      sys('enable', 'remy.service'),
      sys('restart', 'remy.service'),
      ['loginctl', 'show-user', '<your user name>', '--property=Linger', '--value'],
    ]);
  });

  it('restarts a daemon that is already running, so a reinstall picks up the new unit', () => {
    const f = fake();
    installerFor('linux', f.ctx)?.install();
    expect(f.commands).toContainEqual(sys('restart', 'remy.service'));
    expect(f.commands).not.toContainEqual(sys('enable', '--now', 'remy.service'));
  });

  it('suggests linger with the real user name and never runs it', () => {
    const f = fake();
    expect(installerFor('linux', { ...f.ctx, user: 'sam' })?.install()).toContain(
      'run: loginctl enable-linger sam',
    );
    expect(f.commands.map((c) => c[1])).not.toContain('enable-linger');
  });

  it('says nothing about linger when it is already on', () => {
    const f = fake({
      fail: (c) => (c === 'loginctl' ? { status: 0, stdout: 'yes\n' } : undefined),
    });
    const said = installerFor('linux', { ...f.ctx, user: 'sam' })?.install();
    expect(said).toBe('The daemon is on and keeps running when you log out.');
  });

  it('gives the service the same REMY_HOME as the person who installed it', () => {
    const f = fake();
    installerFor('linux', { ...f.ctx, remyHome: '/data/my remy' })?.install();
    expect(f.written[unitPath]).toContain('Environment="REMY_HOME=/data/my remy"\n');
    const plain = fake();
    installerFor('linux', plain.ctx)?.install();
    expect(plain.written[unitPath]).not.toContain('REMY_HOME');
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
    const f = fake({ fail: (_c, a) => (a[1] === 'restart' ? { status: 1 } : undefined) });
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

describe('schtasks installer', () => {
  const win = () => {
    const f = fake();
    f.ctx.entry = {
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      execArgv: [],
      script: 'C:\\r\\remy.js',
    };
    return f;
  };

  it('creates the logon task and starts it', () => {
    const f = win();
    expect(installerFor('win32', f.ctx)?.install()).toBe(
      'The daemon is on and starts when you log in.',
    );
    expect(f.commands).toEqual([
      [
        'schtasks',
        '/Create',
        '/SC',
        'ONLOGON',
        '/TN',
        'RemyDaemon',
        '/TR',
        '"C:\\Program Files\\nodejs\\node.exe" C:\\r\\remy.js daemon run',
        '/RL',
        'LIMITED',
        '/F',
      ],
      ['schtasks', '/Run', '/TN', 'RemyDaemon'],
    ]);
    expect(f.written).toEqual({});
  });

  it('says so when the task cannot be created', () => {
    const f = fake({ fail: () => ({ status: 1 }) });
    expect(() => installerFor('win32', f.ctx)?.install()).toThrow('not as administrator');
  });

  it('ends and deletes the task', () => {
    const f = win();
    installerFor('win32', f.ctx)?.uninstall();
    expect(f.commands).toEqual([
      ['schtasks', '/End', '/TN', 'RemyDaemon'],
      ['schtasks', '/Delete', '/TN', 'RemyDaemon', '/F'],
    ]);
  });

  it('reads status from a query', () => {
    const on = win();
    expect(installerFor('win32', on.ctx)?.status().on).toBe(true);
    expect(on.commands[0]).toEqual(['schtasks', '/Query', '/TN', 'RemyDaemon']);
    expect(installerFor('win32', fake({ fail: () => ({ status: 1 }) }).ctx)?.isOn()).toBe(false);
  });
});

describe('escaping', () => {
  const nasty = [
    '/home/josé de ñandú/my "quoted" dir/it\'s',
    '/tmp/$(touch pwned) `id` ; rm -rf ~ | & > x',
    '/tmp/%h/%n/$HOME/${PATH}',
    'C:\\Users\\Zoë Ångström\\a "b" c\\',
  ];
  const at = (script: string) => ({ execPath: '/usr/bin/node', execArgv: [], script });

  it('keeps every systemd word inside quotes, on one line', () => {
    for (const p of nasty) {
      const line =
        systemdUnit(at(p))
          .split('\n')
          .find((l) => l.startsWith('ExecStart=')) ?? '';
      // Undo the quoting the way systemd does: `\x` is x, `%%` is %, `$$` is $.
      const words = [...line.slice('ExecStart='.length).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        (m[1] ?? '').replace(/\\(.)/g, '$1').replaceAll('%%', '%').replaceAll('$$', '$'),
      );
      expect(words).toEqual(['/usr/bin/node', p, 'daemon', 'run']);
      expect(line.replace(/"(?:[^"\\]|\\.)*"/g, '').trim()).toBe('ExecStart=');
    }
  });

  it('turns % and $ into literals in the unit', () => {
    const unit = systemdUnit(at('/tmp/%h/$HOME'), '/a/%h');
    expect(unit).toContain('"/tmp/%%h/$$HOME"');
    expect(unit).toContain('Environment="PATH=/a/%%h"');
  });

  it('refuses a newline or other control character in any of the three', () => {
    const bad = at('/x\n[Service]\nExecStart=/bin/evil');
    expect(() => systemdUnit(bad)).toThrow('control character');
    expect(() => systemdUnit(at('/x'), '/a\nB=c')).toThrow('control character');
    expect(() => taskCommand(bad)).toThrow('control character');
    expect(() => launchAgentPlist(bad, 'l')).not.toThrow();
    expect(launchAgentPlist(at('</string><string>x'), 'l')).not.toContain('</string><string>x');
  });

  it('keeps the task command one argument and quotes every awkward word', () => {
    for (const p of nasty) {
      const args = schtasksCreateArgs({ execPath: 'C:\\n\\node.exe', execArgv: [], script: p });
      expect(args).toHaveLength(10);
      expect(args[6]).toBe(taskCommand({ execPath: 'C:\\n\\node.exe', execArgv: [], script: p }));
      expect(args[6]?.endsWith(' daemon run')).toBe(true);
    }
  });

  it('runs commands as argument lists, never as shell text', () => {
    const f = fake();
    f.ctx.entry = at(nasty[1] as string);
    installerFor('linux', f.ctx)?.install();
    installerFor('darwin', f.ctx)?.install();
    for (const c of f.commands) expect(c.every((w) => !w.includes('pwned'))).toBe(true);
  });
});
