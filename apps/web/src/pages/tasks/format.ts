// Small helpers the task screens share: plain-words labels and times.
import type { Risk, TaskStatus } from '../../api/index.tsx';

/** Words for each kind of action, in the voice the brand guide asks for: outcome first, verb and object. */
export const RISK: Record<
  Risk,
  { kind: string; approve: string; decline: string; review: string; noun: string }
> = {
  read: {
    kind: 'Reads',
    approve: 'Approve',
    decline: 'Decline',
    review: 'Review and approve',
    noun: 'action',
  },
  write: {
    kind: 'Changes something',
    approve: 'Approve',
    decline: 'Decline',
    review: 'Review and approve',
    noun: 'change',
  },
  send_as_user: {
    kind: 'Sends as you',
    approve: 'Send as you',
    decline: "Don't send",
    review: 'Review and send',
    noun: 'message',
  },
  spend_money: {
    kind: 'Spends money',
    approve: 'Approve and pay',
    decline: "Don't pay",
    review: 'Review and pay',
    noun: 'payment',
  },
  irreversible: {
    kind: 'Cannot be undone',
    approve: 'Approve',
    decline: 'Decline',
    review: 'Review and approve',
    noun: 'action',
  },
};

export type Group = 'needs' | 'running' | 'stopped';

export const groupOf = (s: TaskStatus): Group =>
  s === 'waiting_approval' || s === 'waiting_user'
    ? 'needs'
    : s === 'running'
      ? 'running'
      : 'stopped';

/** The state word in a list row. */
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
      return 'stopped';
  }
}

/** "18:51" from an ISO time. The mock writes UTC on purpose so it reads the same everywhere. */
export function clockOf(iso: string, utc: boolean, seconds = false): string {
  if (!iso) return '';
  if (utc) return iso.slice(11, seconds ? 19 : 16);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, seconds ? 8 : 5);
}

export const money = (n: number) => `$${n.toFixed(2)}`;

/** "create_issue" becomes "Create issue". Used only when the server sends no plain label. */
export function humanTool(tool: string): string {
  const s = tool.replaceAll(/[_.-]+/g, ' ').trim();
  return s ? s[0]?.toUpperCase() + s.slice(1) : 'Step';
}

export const quietButton =
  'cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50 border-edge-hi bg-transparent text-text no-underline hover:bg-raise';
export const primaryButton =
  'cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50 border-text bg-text text-bg no-underline hover:bg-white';
