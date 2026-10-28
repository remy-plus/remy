// The `/resume` picker: unfinished tasks, newest first. Arrows move, Enter resumes, Esc closes.
import { Box, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, useState } from 'react';
import { type SessionRow, shortId } from './chat.ts';
import { Hints } from './hints.ts';
import { SPACE, type Theme } from './theme.ts';

/** `just now`, `5 min ago`, `3 h ago`, `2 days ago`. */
export function ageWord(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.floor(mins / (60 * 24));
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const STATE_WORDS: Record<string, string> = {
  running: 'interrupted',
  waiting_approval: 'needs approval',
  waiting_user: 'has a question',
  paused: 'paused, out of budget',
};
export const stateWord = (status: string) => STATE_WORDS[status] ?? status;

/** Moves the highlighted row, wrapping at the ends. */
export const moveSelection = (at: number, by: number, count: number) =>
  count <= 0 ? 0 : (((at + by) % count) + count) % count;

export function SessionPicker(p: {
  rows: SessionRow[];
  theme: Theme;
  onPick: (taskId: string) => void;
  onCancel: () => void;
  now?: number;
}): ReactElement {
  const { theme, rows } = p;
  const [at, setAt] = useState(0);
  useInput((_ch, key) => {
    if (key.escape) return p.onCancel();
    if (key.upArrow) return setAt((i) => moveSelection(i, -1, rows.length));
    if (key.downArrow) return setAt((i) => moveSelection(i, 1, rows.length));
    const row = rows[at];
    if (key.return && row) p.onPick(row.taskId);
  });
  const mutedColor = theme.color('muted');
  const muted = mutedColor ? { color: mutedColor } : { dimColor: true };
  const accent = theme.color('accent');
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: 1 },
    h(Text, { bold: true }, 'Resume which task?'),
    h(Text, theme.props('faint'), theme.symbols.rule.repeat(SPACE.rule)),
    ...rows.map((r, i) => {
      const on = i === at;
      return h(
        Box,
        { key: r.taskId },
        h(
          Box,
          { width: 2, flexShrink: 0 },
          h(Text, on && accent ? { color: accent } : muted, on ? theme.symbols.prompt : ' '),
        ),
        h(
          Box,
          { flexShrink: 1, flexGrow: 1 },
          h(Text, { wrap: 'truncate-end', ...(on ? { bold: true } : {}) }, r.title),
        ),
        h(
          Box,
          { flexShrink: 0, marginLeft: 2 },
          h(
            Text,
            muted,
            `${shortId(r.taskId)} · ${r.background ? 'running in the background' : stateWord(r.status)} · ${ageWord(r.updatedAt, p.now)}`,
          ),
        ),
      );
    }),
    h(
      Box,
      { marginTop: theme.space.turn },
      h(Hints, { hint: '↑↓ choose · Enter resume · Esc cancel', theme }),
    ),
  );
}
