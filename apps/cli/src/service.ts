// The daemon as an operating-system service. One port, one installer per platform; the command
// runner and the file writer are injected, so tests see the exact files and commands and nothing runs.
import { join } from 'node:path';
import type { EntryPoint } from './background.ts';
import { LAUNCH_LABEL, launchAgentPlist } from './daemon.ts';

/** What a finished command left behind. `status` is null when the program could not start. */
export interface RunResult {
  status: number | null;
  stdout?: string;
}

/** Runs one program with an argument list. Never a shell string. */
export type RunCommand = (cmd: string, args: string[]) => RunResult;

export interface ServiceFiles {
  /** Writes the file, making its folder first. */
  write(path: string, text: string): void;
  remove(path: string): void;
}

export interface ServiceContext {
  entry: EntryPoint;
  /** The user's home folder. */
  homeDir: string;
  /** The daemon's log file, for platforms that write one. */
  logFile: string;
  /** The PATH to give the service, where the platform sets almost none. */
  path?: string | undefined;
  /** REMY_HOME when the person set one, so a service started by the system reads the same data. */
  remyHome?: string | undefined;
  /** The login name, for the one linger line systemd needs. */
  user?: string | undefined;
  run: RunCommand;
  files: ServiceFiles;
}

export interface ServiceStatus {
  on: boolean;
  message: string;
}

export interface ServiceInstaller {
  readonly kind: 'launchd' | 'systemd' | 'schtasks';
  /** Plain name for `remy doctor`. */
  readonly label: string;
  /** The one step that turns the daemon on. */
  readonly enableStep: string;
  /** When the service manager cannot be used here, one line saying why. */
  unavailable(): string | undefined;
  /** Installs and starts the service. Throws when the platform refuses. */
  install(): string;
  uninstall(): string;
  status(): ServiceStatus;
  /** True when the daemon is installed and running. */
  isOn(): boolean;
}

/** Refuses text a service file could read as more than one line. */
function singleLine(what: string, text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${what} has a control character.`);
  return text;
}

/**
 * One systemd word in double quotes. Inside them `\` and `"` are escaped, `%` is doubled so it is
 * not a specifier, and `$` is doubled where the setting expands variables (ExecStart does).
 */
export function systemdQuote(text: string, what: string, expandsVariables = true): string {
  const safe = singleLine(what, text)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%');
  return `"${expandsVariables ? safe.replaceAll('$', '$$$$') : safe}"`;
}

/** A systemd user unit: starts at login and comes back after a failure. */
export function systemdUnit(entry: EntryPoint, path = '', remyHome = ''): string {
  if (!entry.execPath.startsWith('/'))
    throw new Error('systemd needs the full path to node, and this one is not.');
  const words = [entry.execPath, ...entry.execArgv, entry.script, 'daemon', 'run']
    .map((w) => systemdQuote(w, 'A path'))
    .join(' ');
  return `[Unit]
Description=Remy daemon: runs your schedules
After=network-online.target

[Service]
Type=simple
ExecStart=${words}
${path ? `Environment=${systemdQuote(`PATH=${path}`, 'PATH', false)}\n` : ''}${remyHome ? `Environment=${systemdQuote(`REMY_HOME=${remyHome}`, 'REMY_HOME', false)}\n` : ''}Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** macOS: a LaunchAgent that starts at login. */
export function launchdInstaller(ctx: ServiceContext): ServiceInstaller {
  const plist = join(ctx.homeDir, 'Library', 'LaunchAgents', `${LAUNCH_LABEL}.plist`);
  const isOn = () => ctx.run('launchctl', ['list', LAUNCH_LABEL]).status === 0;
  return {
    kind: 'launchd',
    label: 'macOS LaunchAgent',
    enableStep: 'Run remy daemon install.',
    unavailable: () => undefined,
    install() {
      ctx.files.write(plist, launchAgentPlist(ctx.entry, ctx.logFile, ctx.path));
      ctx.run('launchctl', ['unload', plist]);
      if (ctx.run('launchctl', ['load', '-w', plist]).status !== 0)
        throw new Error('macOS did not start the daemon.');
      return 'The daemon is on and starts when you log in.';
    },
    uninstall() {
      ctx.run('launchctl', ['unload', '-w', plist]);
      ctx.files.remove(plist);
      return 'The daemon is off.';
    },
    status: () => ({
      on: isOn(),
      message: isOn()
        ? 'The daemon is on.'
        : 'The daemon is off. Turn it on with remy daemon install.',
    }),
    isOn,
  };
}

/** One word as Windows programs read a command line: quoted when it needs it, quotes escaped. */
export function windowsArg(text: string): string {
  singleLine('A path', text);
  if (text !== '' && !/[\s"]/.test(text)) return text;
  let out = '"';
  let slashes = 0;
  for (const c of text) {
    if (c === '\\') slashes++;
    else if (c === '"') {
      out += `${'\\'.repeat(slashes * 2 + 1)}"`;
      slashes = 0;
    } else {
      out += '\\'.repeat(slashes) + c;
      slashes = 0;
    }
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

export const TASK_NAME = 'RemyDaemon';
/** The longest /TR text schtasks accepts. */
const TR_LIMIT = 261;

/** The command the scheduled task runs: this node, this install, `daemon run`. */
export function taskCommand(entry: EntryPoint): string {
  const text = [entry.execPath, ...entry.execArgv, entry.script, 'daemon', 'run']
    .map(windowsArg)
    .join(' ');
  if (text.length > TR_LIMIT)
    throw new Error(
      `Windows allows ${TR_LIMIT} characters for a task command; this one is ${text.length}. Install Remy under a shorter path.`,
    );
  return text;
}

/** The schtasks arguments that create the logon task. No shell reads them, and no /RU: it runs as you. */
export function schtasksCreateArgs(entry: EntryPoint): string[] {
  return [
    '/Create',
    '/SC',
    'ONLOGON',
    '/TN',
    TASK_NAME,
    '/TR',
    taskCommand(entry),
    '/RL',
    'LIMITED',
    '/F',
  ];
}

const UNIT = 'remy.service';

/** One word for a POSIX shell, in single quotes, for the line we print and never run. */
export function shellQuote(text: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

/** Linux: a systemd user unit that starts at login. */
export function systemdInstaller(ctx: ServiceContext): ServiceInstaller {
  const unit = join(ctx.homeDir, '.config', 'systemd', 'user', UNIT);
  const ctl = (...args: string[]) => ctx.run('systemctl', ['--user', ...args]);
  const isOn = () => {
    const r = ctl('is-active', UNIT);
    return r.status === 0 && (r.stdout ?? '').trim() === 'active';
  };
  return {
    kind: 'systemd',
    label: 'systemd user unit',
    enableStep: 'Run remy daemon install.',
    unavailable: () =>
      ctl('show-environment').status === 0
        ? undefined
        : 'systemd user services are not available here (no systemctl, a container, or WSL without systemd).',
    install() {
      const why = this.unavailable();
      if (why) {
        const run = [ctx.entry.execPath, ...ctx.entry.execArgv, ctx.entry.script, 'daemon', 'run'];
        throw new Error(
          `${why}\nRun this in your own service or a terminal instead:\n  ${run.map(shellQuote).join(' ')}`,
        );
      }
      ctx.files.write(unit, systemdUnit(ctx.entry, ctx.path, ctx.remyHome));
      ctl('daemon-reload');
      // `enable --now` leaves a daemon that is already running on the old unit and the old code.
      if (ctl('enable', UNIT).status !== 0 || ctl('restart', UNIT).status !== 0)
        throw new Error(
          'systemd did not start the daemon. Check: systemctl --user status remy.service',
        );
      const user = ctx.user ?? '<your user name>';
      const linger = ctx.run('loginctl', ['show-user', user, '--property=Linger', '--value']);
      const lingers = linger.status === 0 && (linger.stdout ?? '').trim() === 'yes';
      return lingers
        ? 'The daemon is on and keeps running when you log out.'
        : `The daemon is on and starts when you log in. To keep it running while you are logged out, run: loginctl enable-linger ${user}`;
    },
    uninstall() {
      ctl('disable', '--now', UNIT);
      ctx.files.remove(unit);
      ctl('daemon-reload');
      return 'The daemon is off.';
    },
    status: () => ({
      on: isOn(),
      message: isOn()
        ? 'The daemon is on.'
        : 'The daemon is off. Turn it on with remy daemon install.',
    }),
    isOn,
  };
}

/** Windows: a Scheduled Task at logon, in your own session and never elevated. */
export function schtasksInstaller(ctx: ServiceContext): ServiceInstaller {
  const isOn = () => ctx.run('schtasks', ['/Query', '/TN', TASK_NAME]).status === 0;
  return {
    kind: 'schtasks',
    label: 'Windows Scheduled Task',
    enableStep: 'Run remy daemon install.',
    unavailable: () => undefined,
    install() {
      if (ctx.run('schtasks', schtasksCreateArgs(ctx.entry)).status !== 0)
        throw new Error(
          'Windows did not create the task. Run remy daemon install from your own account, not as administrator.',
        );
      ctx.run('schtasks', ['/Run', '/TN', TASK_NAME]);
      return 'The daemon is on and starts when you log in.';
    },
    uninstall() {
      ctx.run('schtasks', ['/End', '/TN', TASK_NAME]);
      ctx.run('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
      return 'The daemon is off.';
    },
    status: () => ({
      on: isOn(),
      message: isOn()
        ? 'The daemon is on.'
        : 'The daemon is off. Turn it on with remy daemon install.',
    }),
    isOn,
  };
}

/** The installer for this platform, or undefined where there is none. */
export function installerFor(platform: string, ctx: ServiceContext): ServiceInstaller | undefined {
  if (platform === 'darwin') return launchdInstaller(ctx);
  if (platform === 'linux') return systemdInstaller(ctx);
  if (platform === 'win32') return schtasksInstaller(ctx);
  return undefined;
}
