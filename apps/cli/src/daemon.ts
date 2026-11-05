// The small program that runs schedules. Each tick starts what is due as a background task; the
// next run is saved first, so a crash can miss a run but never repeats one.
import type { EntryPoint } from './background.ts';
import { dueNow, nextRun, parseWhen } from './schedule.ts';
import type { ScheduleStore } from './schedule-store.ts';

export const TICK_MS = 30_000;
export const LAUNCH_LABEL = 'plus.remy.daemon';

export async function tick(
  store: ScheduleStore,
  now: Date,
  start: (prompt: string) => Promise<string>,
  log: (line: string) => void = () => {},
): Promise<void> {
  for (const s of dueNow(store.list(), now)) {
    const planned = {
      ...s,
      nextRun: nextRun(parseWhen(s.when), now).toISOString(),
      lastRun: now.toISOString(),
    };
    store.update(planned);
    try {
      store.update({ ...planned, lastTask: await start(s.prompt) });
    } catch (e) {
      log(`${s.id} did not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const xml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A macOS LaunchAgent: starts the daemon at login and brings it back if it stops. */
export function launchAgentPlist(entry: EntryPoint, logFile: string, path = ''): string {
  const args = [entry.execPath, ...entry.execArgv, entry.script, 'daemon']
    .map((a) => `    <string>${xml(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}
