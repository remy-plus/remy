// Small helpers the task screens share: plain-words labels and times.
import type { Risk, TaskStatus, TrustLevel } from '../../api/index.tsx';
import { plainStep } from '../../lib/feed.ts';
import { clock } from '../../lib/when.ts';

/**
 * Words for each kind of action, in the voice the brand guide asks for: outcome first, verb and
 * object. `after` and `stopped` are the two sentences a person is owed before they answer: what
 * happens if they approve, and what happens if they say not now.
 */
export const RISK: Record<
  Risk,
  {
    kind: string;
    approve: string;
    decline: string;
    review: string;
    noun: string;
    after: string;
    stopped: string;
  }
> = {
  read: {
    kind: 'Reads',
    approve: 'Approve',
    decline: 'Not now',
    review: 'Review and approve',
    noun: 'action',
    after: 'Remy reads it, then carries on.',
    stopped: 'Nothing was read.',
  },
  write: {
    kind: 'Changes something',
    approve: 'Approve',
    decline: 'Not now',
    review: 'Review and approve',
    noun: 'change',
    after: 'Remy makes this one change, then carries on.',
    stopped: 'Nothing was changed.',
  },
  send_as_user: {
    kind: 'Sends as you',
    approve: 'Send as you',
    decline: 'Not now',
    review: 'Review and send',
    noun: 'message',
    after: 'Remy sends this one message, then carries on.',
    stopped: 'Nothing was sent.',
  },
  spend_money: {
    kind: 'Spends money',
    approve: 'Approve and pay',
    decline: 'Not now',
    review: 'Review and pay',
    noun: 'payment',
    after: 'Remy pays this once, then carries on.',
    stopped: 'Nothing was paid.',
  },
  irreversible: {
    kind: 'Cannot be undone',
    approve: 'Approve',
    decline: 'Not now',
    review: 'Review and approve',
    noun: 'action',
    after: 'Remy does this once. It cannot be undone.',
    stopped: 'Nothing was done.',
  },
};

/** How much Remy does on its own, in the words the brief asks for. The stored values do not change. */
export const trustWords: Record<TrustLevel, string> = {
  ask: 'Check with me first',
  steady: 'Handle routine things',
  away: "Work on its own while I'm away",
};

/** The same level as a sentence, for the approval dialog's "Why Remy is asking". */
export const trustSentence: Record<TrustLevel, string> = {
  ask: 'You asked to be checked with first.',
  steady: 'You let Remy handle routine things.',
  away: 'You let Remy work on its own while you are away.',
};

export type Group = 'needs' | 'running' | 'stopped';

export const groupOf = (s: TaskStatus): Group =>
  s === 'waiting_approval' || s === 'waiting_user'
    ? 'needs'
    : s === 'running'
      ? 'running'
      : 'stopped';

/** The state word in a list row. A job that stopped did not finish; it did not "fail". */
export function stateWord(s: TaskStatus): string {
  switch (s) {
    case 'waiting_approval':
      return 'waiting for your OK';
    case 'waiting_user':
      return 'waiting for your answer';
    case 'running':
      return 'working';
    case 'paused':
      return 'paused';
    case 'succeeded':
      return 'done';
    default:
      return "didn't finish";
  }
}

/**
 * A time the server sent, in 12-hour words: "18:40" or an ISO time becomes "6:40 PM". Anything
 * that is not a time is left exactly as it came, so a plain word is never mangled.
 */
export function plainTime(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (hm) {
    const d = new Date(2000, 0, 1, Number(hm[1]), Number(hm[2]), Number(hm[3] ?? 0));
    return clock(d);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : clock(d);
}

export const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * A plain line for a step the server sent no label for. It goes through the same words the chat
 * feed uses, so a tool's own name ("create_issue") never reaches the screen.
 */
export function humanTool(tool: string): string {
  return plainStep(tool).past;
}

export const quietButton =
  'cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50 border-edge-hi bg-transparent text-text no-underline hover:bg-raise';
export const primaryButton =
  'cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50 border-text btn-solid no-underline';
