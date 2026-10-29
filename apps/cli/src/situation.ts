// The situation line block sent with each user message: when it is, what is running in the
// background, and which apps are connected. Built once per message (see recall.ts), so it reads
// like the moment the user spoke and does not disturb the prompt cache afterwards.
import type { BgState } from './background.ts';
import type { ConnectionRow } from './connections-view.ts';

export interface BackgroundTask {
  id: string;
  state: BgState;
  prompt: string;
}

export interface SituationInput {
  now: Date;
  /** IANA zone; the system's own when absent. */
  timeZone?: string;
  background: BackgroundTask[];
  connections: ConnectionRow[];
}

/** At most this many background tasks are listed. */
export const MAX_BACKGROUND = 5;

const quote = (s: string, max = 60) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return JSON.stringify(line.length > max ? `${line.slice(0, max - 1)}…` : line);
};

export function situationBlock(i: SituationInput): string {
  const zone = i.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  }).format(i.now);
  const lines = [`Situation when the user sent the next message (from Remy, not the user):`];
  lines.push(`- Local time: ${when} (${zone}).`);
  const live = i.background.filter((t) => t.state !== 'done' && t.state !== 'stopped');
  if (live.length)
    lines.push(
      `- Background tasks: ${live
        .slice(0, MAX_BACKGROUND)
        .map((t) => `${t.id} ${t.state}, ${quote(t.prompt)}`)
        .join('; ')}.`,
    );
  const on = i.connections.filter((c) => c.status === 'connected').map((c) => c.name);
  const signin = i.connections.filter((c) => c.status === 'needs_signin').map((c) => c.name);
  if (on.length) lines.push(`- Connected apps: ${on.join(', ')}.`);
  if (signin.length) lines.push(`- Need sign-in (remy connect auth <name>): ${signin.join(', ')}.`);
  return lines.join('\n');
}
