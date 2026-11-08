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
export function systemdUnit(entry: EntryPoint, path = ''): string {
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
${path ? `Environment=${systemdQuote(`PATH=${path}`, 'PATH', false)}\n` : ''}Restart=on-failure
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

/** The installer for this platform, or undefined where there is none. */
export function installerFor(platform: string, ctx: ServiceContext): ServiceInstaller | undefined {
  if (platform === 'darwin') return launchdInstaller(ctx);
  return undefined;
}
