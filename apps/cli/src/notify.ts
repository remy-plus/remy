// Desktop notifications for background tasks. macOS only, through osascript; elsewhere the log is
// the record. Text is fixed phrases plus the task's own prompt (never page text or tool output).
import { execFile } from 'node:child_process';
import type { TaskStatus } from '@remy/core';
import { nextCommand, notifyTitle } from './background.ts';

/** Escapes text for an AppleScript double-quoted string and drops control characters. */
export function appleScriptString(text: string): string {
  const clean = text.replace(/\p{Cc}+/gu, ' ');
  return `"${clean.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export interface Note {
  title: string;
  body: string;
}

/** The notification for a task that ended or needs the user; undefined when none is due. */
export function notificationFor(p: {
  status: TaskStatus;
  id: string;
  prompt: string;
}): Note | undefined {
  const title = `"${notifyTitle(p.prompt)}"`;
  const next = nextCommand(p.status, p.id);
  switch (p.status) {
    case 'succeeded':
      return { title: 'Remy finished a task', body: `${title} is done. See it: ${next}` };
    case 'failed':
      return { title: 'Remy could not finish', body: `${title} did not finish. Details: ${next}` };
    case 'waiting_approval':
      return {
        title: 'Remy needs your OK',
        body: `${title} is waiting for approval. Run: ${next}`,
      };
    case 'waiting_user':
      return { title: 'Remy has a question', body: `${title} is waiting for you. Run: ${next}` };
    case 'paused':
      return { title: 'Remy paused a task', body: `${title} used its budget. Run: ${next}` };
    default:
      return undefined;
  }
}

export type RunScript = (script: string) => void;

const defaultRun: RunScript = (script) => {
  execFile('osascript', ['-e', script], { timeout: 5000 }, () => {});
};

/** Shows a notification on macOS unless REMY_NOTIFY=off. Returns whether one was sent. */
export function notify(
  note: Note,
  o: { env: Record<string, string | undefined>; platform?: string; run?: RunScript },
): boolean {
  if (o.env.REMY_NOTIFY === 'off') return false;
  if ((o.platform ?? process.platform) !== 'darwin') return false;
  const script = `display notification ${appleScriptString(note.body)} with title ${appleScriptString(note.title)}`;
  try {
    (o.run ?? defaultRun)(script);
    return true;
  } catch {
    return false;
  }
}
