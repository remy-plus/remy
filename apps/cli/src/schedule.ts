// Schedules: "every day at 9" turned into a next run time, plain enough to test without a clock.
// Each run is an ordinary background task with ordinary approvals; a schedule grants nothing.
export type When =
  | { kind: 'every'; minutes: number }
  | { kind: 'changes'; path: string }
  | { kind: 'at'; hour: number; minute: number; days?: number[] };

export interface Schedule {
  id: string;
  prompt: string;
  /** As the user wrote it. */
  when: string;
  createdAt: string;
  /** ISO time of the next run. */
  nextRun: string;
  /** For a schedule that watches a file or folder: when it last changed. */
  seenChange?: number;
  lastRun?: string;
  lastTask?: string;
  paused?: boolean;
}

const MIN_MINUTES = 5;
/** How often a watch looks, and the shortest gap between its runs. */
const WATCH_MINUTES = 5;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAYS = [1, 2, 3, 4, 5];
const HELP =
  'Say when like "every day at 9", "weekdays at 8:30", "every monday at 9am", "every 2 hours", "hourly" or "when ~/Downloads changes".';

function clockTime(text: string): { hour: number; minute: number } | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text.trim());
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3]) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  return hour < 24 && minute < 60 ? { hour, minute } : undefined;
}

export function parseWhen(input: string): When {
  const watch = /^when (.+) changes$/i.exec(input.trim());
  if (watch) return { kind: 'changes', path: watch[1] as string };
  const text = input.trim().toLowerCase();
  if (text === 'hourly') return { kind: 'every', minutes: 60 };
  const every = /^every (\d+) (minute|hour)s?$/.exec(text);
  if (every) {
    const minutes = Number(every[1]) * (every[2] === 'hour' ? 60 : 1);
    if (minutes < MIN_MINUTES)
      throw new Error(`A schedule can run at most every ${MIN_MINUTES} minutes.`);
    return { kind: 'every', minutes };
  }
  const at = /^(daily|weekdays|every day|every [a-z]+) at (.+)$/.exec(text);
  const time = at ? clockTime(at[2] as string) : undefined;
  if (!at || !time) throw new Error(HELP);
  const on = at[1] as string;
  if (on === 'daily' || on === 'every day') return { kind: 'at', ...time };
  if (on === 'weekdays') return { kind: 'at', ...time, days: WEEKDAYS };
  const day = DAYS.indexOf(on.replace('every ', ''));
  if (day < 0) throw new Error(HELP);
  return { kind: 'at', ...time, days: [day] };
}

/** The next time after `from`, in local time. */
export function nextRun(when: When, from: Date): Date {
  if (when.kind === 'every') return new Date(from.getTime() + when.minutes * 60_000);
  // A watch has no next time: the daemon checks it every tick.
  if (when.kind === 'changes') return new Date(from.getTime() + WATCH_MINUTES * 60_000);
  const next = new Date(from);
  next.setHours(when.hour, when.minute, 0, 0);
  while (next <= from || (when.days && !when.days.includes(next.getDay())))
    next.setDate(next.getDate() + 1);
  return next;
}

export const dueNow = (schedules: Schedule[], now: Date): Schedule[] =>
  schedules.filter((s) => !s.paused && new Date(s.nextRun) <= now);

/** The plain list for `remy schedule list` and /schedules. */
export function plainSchedules(all: Schedule[]): string {
  if (!all.length)
    return 'No schedules yet. Add one with remy schedule add "every day at 9" "<prompt>".';
  return all
    .map((s) => {
      const state = s.paused ? 'paused' : `next ${new Date(s.nextRun).toLocaleString()}`;
      const prompt = s.prompt.length > 60 ? `${s.prompt.slice(0, 59)}…` : s.prompt;
      return `${s.id}  ${s.when}  ${state}  ${prompt}`;
    })
    .join('\n');
}
