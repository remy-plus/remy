// What a screen reader is told while a chat changes. One short sentence per real change: a new
// step is read at most every few seconds, an approval or a finished answer at once. Never the
// whole feed again, which is why the step list itself is not a live region.
import { useEffect, useRef, useState } from 'react';
import type { ChatTurn } from '../api/types.ts';
import type { FeedLine } from './feed.ts';

const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** The step Remy is on right now, in the plain words the feed uses. Empty when nothing is in progress. */
export function currentStep(lines: readonly FeedLine[]): string {
  const live = [...lines].reverse().find((l) => l.state === 'working');
  return live?.text ?? '';
}

/** A turn that just ended: what a person who cannot see the page needs to hear. */
export function endedAnnouncement(turn: ChatTurn): string {
  if (turn.state === 'done') {
    const answer = turn.answer ? clip(turn.answer, 200) : '';
    return answer ? `Remy answered. ${answer}` : 'Remy finished.';
  }
  if (turn.state === 'stopped') return 'Remy stopped before finishing.';
  return 'Remy could not finish that.';
}

const LIVE = new Set<ChatTurn['state']>(['working', 'waiting']);

/**
 * Compares a chat's turns with the last look and returns a sentence for a turn that went from live to
 * ended in front of the person. A chat that is simply opened says nothing.
 */
export function announceEnded(
  before: ReadonlyMap<string, ChatTurn['state']>,
  turns: readonly ChatTurn[],
): string {
  for (const t of [...turns].reverse()) {
    const was = before.get(t.taskId);
    if (was && LIVE.has(was) && !LIVE.has(t.state)) return endedAnnouncement(t);
  }
  return '';
}

/** A value that changes at most once every `ms`, always ending on the latest one. */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    const t = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);
  return shown;
}

/** The sentences for a chat that changes, kept as one string a persistent live region can show. */
export function useEndedAnnouncement(turns: readonly ChatTurn[] | undefined): string {
  const before = useRef<ReadonlyMap<string, ChatTurn['state']> | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (!turns) return;
    const prior = before.current;
    before.current = new Map(turns.map((t) => [t.taskId, t.state]));
    if (!prior) return; // the first look is not news
    const next = announceEnded(prior, turns);
    if (next) setSaid(next);
  }, [turns]);
  return said;
}
