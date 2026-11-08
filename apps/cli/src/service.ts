// The daemon as an operating-system service. One port, one installer per platform; the command
// runner and the file writer are injected, so tests see the exact files and commands and nothing runs.
import type { EntryPoint } from './background.ts';

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
