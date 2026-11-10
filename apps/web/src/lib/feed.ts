// Turns a job's calls into plain lines for the chat feed: one line per step, never a tool name,
// an id or a hash. The server sends each call's `args`; types.ts does not list them yet.
import type { CallView, Risk } from '../api/types.ts';

export type CallWithArgs = CallView & { args?: unknown };
export type FeedState = 'done' | 'working' | 'waiting' | 'failed';

export interface PlainStep {
  /** "Reading quotes/acme.md" while it happens. */
  now: string;
  /** "Read quotes/acme.md" once it has happened. */
  past: string;
}

const str = (args: unknown, ...keys: string[]): string => {
  if (typeof args !== 'object' || args === null) return '';
  for (const k of keys) {
    const v = (args as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

const short = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const host = (url: string) => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(
      /^www\./,
      '',
    );
  } catch {
    return short(url, 40);
  }
};

const withObject = (
  verb: [string, string],
  object: string,
  fallback: [string, string],
): PlainStep =>
  object
    ? { now: `${verb[0]} ${object}`, past: `${verb[1]} ${object}` }
    : { now: fallback[0], past: fallback[1] };

/** The plain words for one call. Unknown tools get a calm generic line, never the tool name. */
export function plainStep(tool: string, args?: unknown): PlainStep {
  const path = str(args, 'path', 'file');
  switch (tool) {
    case 'read_file':
      return withObject(['Reading', 'Read'], path, ['Reading a file', 'Read a file']);
    case 'write_file':
      return withObject(['Writing', 'Wrote'], path, ['Writing a file', 'Wrote a file']);
    case 'edit_file':
      return withObject(['Editing', 'Edited'], path, ['Editing a file', 'Edited a file']);
    case 'delete_file':
      return withObject(['Deleting', 'Deleted'], path, ['Deleting a file', 'Deleted a file']);
    case 'move_file':
      return withObject(['Moving', 'Moved'], str(args, 'from'), ['Moving a file', 'Moved a file']);
    case 'make_dir':
      return withObject(['Creating folder', 'Created folder'], path, [
        'Creating a folder',
        'Created a folder',
      ]);
    case 'list_files':
      return withObject(['Looking in', 'Looked in'], path === '.' ? '' : path, [
        'Looking through your files',
        'Looked through your files',
      ]);
    case 'web_search':
    case 'research': {
      const q = short(str(args, 'query', 'question', 'topic'));
      return q
        ? { now: `Searching the web for ${q}`, past: `Searched the web for ${q}` }
        : { now: 'Searching the web', past: 'Searched the web' };
    }
    case 'fetch_url': {
      const u = str(args, 'url');
      return u
        ? { now: `Opening ${host(u)}`, past: `Opened ${host(u)}` }
        : { now: 'Opening a page', past: 'Opened a page' };
    }
    case 'run_command':
    case 'computer_run':
      return { now: 'Running a command', past: 'Ran a command' };
    case 'calculate':
      return { now: 'Calculating', past: 'Calculated' };
    case 'ask_user':
      return { now: 'Asking you something', past: 'Asked you something' };
    case 'remember':
    case 'save_howto':
    case 'save_skill':
      return { now: 'Making a note', past: 'Made a note' };
    case 'recall':
      return { now: 'Checking what it knows', past: 'Checked what it knows' };
    case 'forget':
      return { now: 'Removing a note', past: 'Removed a note' };
    case 'schedule_task':
    case 'list_schedules':
      return { now: 'Checking the schedule', past: 'Checked the schedule' };
    case 'update_plan':
      return { now: 'Planning the next steps', past: 'Planned the next steps' };
    case 'triage':
    case 'home':
      return { now: 'Looking at what needs you', past: 'Looked at what needs you' };
    default:
      return { now: 'Working on it', past: 'Worked on it' };
  }
}

export interface FeedLine {
  id: string;
  state: FeedState;
  text: string;
  /** What it did, in a sentence, for the expanded view. */
  detail: string;
  /** A short piece of the result, when there is one. */
  snippet?: string;
  /** ISO time, when the server sent one. */
  at?: string;
}

const clip = (s: string, max: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** One line per call, in order. `finish` is the answer, not a step. */
export function feedLines(calls: CallView[], pendingCallId?: string): FeedLine[] {
  return [...calls]
    .sort((a, b) => a.step - b.step)
    .filter((c) => c.tool !== 'finish')
    .map((c) => {
      const p = plainStep(c.tool, (c as CallWithArgs).args);
      const waiting = pendingCallId !== undefined && c.callId === pendingCallId;
      const failed = c.result ? !c.result.ok : false;
      const state: FeedState = waiting
        ? 'waiting'
        : failed
          ? 'failed'
          : c.result?.ok
            ? 'done'
            : 'working';
      const finished = state === 'done' || state === 'failed';
      const text = c.label ?? (finished ? p.past : p.now);
      const detail = failed
        ? `${p.past}. It did not work out.`
        : state === 'done'
          ? `${p.past}.`
          : state === 'waiting'
            ? `${p.now}. Waiting for your OK.`
            : `${p.now}.`;
      const snippet = c.result?.ok ? clip(c.result.content, 160) : undefined;
      return {
        id: c.callId,
        state,
        text,
        detail,
        ...(snippet && { snippet }),
        ...(c.at && { at: c.at }),
      };
    });
}

/** One plain sentence for an approval card, from what the server sent. */
export function approvalSentence(preview: string, risk: Risk): string {
  const one = clip(preview, 200);
  if (one) return one;
  switch (risk) {
    case 'send_as_user':
      return 'Remy wants to send something as you.';
    case 'spend_money':
      return 'Remy wants to spend money.';
    case 'irreversible':
      return 'Remy wants to do something that cannot be undone.';
    case 'write':
      return 'Remy wants to change something.';
    default:
      return 'Remy wants to do something.';
  }
}
