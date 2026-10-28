// /memory: what Remy remembers about the user, newest first. Enter edits a note, D deletes it
// (after a yes), Shift+C clears them all (after a yes). The key logic is a pure reducer so it can
// be tested without a terminal; the panel draws in the centered dialog or in the classic layout.

import { MEMORY_MAX_CHARS, type MemoryEntry } from '@remy/tools';
import { Box, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { Hints } from './hints.ts';
import { KIND_LABEL, type MemoryStore, newestFirst } from './memory.ts';
import { type StepKey, typeInto } from './onboarding.ts';
import { Dialog } from './screen/dialog.ts';
import { moveSelection } from './session-picker.ts';
import type { Theme } from './theme.ts';

export type MemoryMode = 'list' | 'edit' | 'delete' | 'clear';

export interface MemoryUi {
  mode: MemoryMode;
  at: number;
  /** The text being edited. */
  text: string;
}

export const memoryStart = (): MemoryUi => ({ mode: 'list', at: 0, text: '' });

export type MemoryAction =
  | { type: 'close' }
  | { type: 'save'; id: string; text: string }
  | { type: 'delete'; id: string }
  | { type: 'clear' };

/** One key press: the next state and, when the key does something to the notes, what. */
export function memoryKey(
  st: MemoryUi,
  input: string,
  key: StepKey & { pageUp?: boolean; pageDown?: boolean },
  entries: MemoryEntry[],
): { state: MemoryUi; action?: MemoryAction } {
  const at = Math.min(st.at, Math.max(0, entries.length - 1));
  const cur = entries[at];
  if (key.ctrl && input === 'c') return { state: st, action: { type: 'close' } };
  if (st.mode === 'edit') {
    if (key.escape) return { state: { ...st, mode: 'list', at } };
    if (key.return) {
      const text = st.text.trim();
      if (!cur || !text) return { state: { ...st, mode: 'list', at } };
      return { state: { ...st, mode: 'list', at }, action: { type: 'save', id: cur.id, text } };
    }
    return { state: { ...st, at, text: typeInto(st.text, input, key, MEMORY_MAX_CHARS) } };
  }
  if (st.mode === 'delete' || st.mode === 'clear') {
    if (/^y$/i.test(input))
      return {
        state: { ...st, mode: 'list', at: st.mode === 'clear' ? 0 : Math.max(0, at - 0) },
        action:
          st.mode === 'clear'
            ? { type: 'clear' }
            : cur
              ? { type: 'delete', id: cur.id }
              : undefined,
      };
    if (key.escape || /^n$/i.test(input)) return { state: { ...st, mode: 'list', at } };
    return { state: st };
  }
  if (key.escape) return { state: st, action: { type: 'close' } };
  if (key.upArrow) return { state: { ...st, at: moveSelection(at, -1, entries.length) } };
  if (key.downArrow || key.tab)
    return { state: { ...st, at: moveSelection(at, 1, entries.length) } };
  if (key.return && cur) return { state: { ...st, mode: 'edit', at, text: cur.text } };
  if (/^d$/i.test(input) && cur) return { state: { ...st, mode: 'delete', at } };
  if (input === 'C' && entries.length) return { state: { ...st, mode: 'clear', at } };
  return { state: st };
}

export function MemoryPanel(p: {
  store: MemoryStore;
  theme: Theme;
  /** Draw inside the centered dialog of the full-screen app. */
  dialog?: { columns: number; rows: number };
  onClose: () => void;
}): ReactElement {
  const { theme } = p;
  // Re-read the file whenever it changes (this panel, or a task that remembered something).
  const [, bump] = useState(0);
  useEffect(() => p.store.subscribe(() => bump((n) => n + 1)), [p.store]);
  const file = p.store.list();
  const entries = [...file].sort(newestFirst);
  const [st, setSt] = useState<MemoryUi>(memoryStart);

  useInput((ch, key) => {
    const r = memoryKey(st, ch, key, p.store.list().sort(newestFirst));
    setSt(r.state);
    const a = r.action;
    if (!a) return;
    if (a.type === 'close') p.onClose();
    else if (a.type === 'save') p.store.edit(a.id, a.text);
    else if (a.type === 'delete') p.store.remove(a.id);
    else p.store.clear();
  });

  const muted = theme.props('muted');
  const accent = theme.color('accent');
  const at = Math.min(st.at, Math.max(0, entries.length - 1));
  const cur = entries[at];
  const width = Math.max(30, (p.dialog?.columns ?? 80) - 12);
  let body: ReactNode;
  if (!entries.length)
    body = h(
      Box,
      { flexDirection: 'column' },
      h(Text, null, 'Nothing saved yet.'),
      h(Text, muted, 'When you tell Remy a lasting preference, it asks before saving it.'),
      h(Box, { height: 1 }),
      h(Hints, { hint: 'Esc close', theme }),
    );
  else if (st.mode === 'delete' || st.mode === 'clear')
    body = h(
      Box,
      { flexDirection: 'column' },
      h(
        Text,
        null,
        st.mode === 'clear' ? `Forget all ${entries.length} notes?` : 'Forget this note?',
      ),
      h(
        Text,
        muted,
        st.mode === 'clear' ? 'They are removed from this computer.' : (cur?.text ?? ''),
      ),
      h(Box, { height: 1 }),
      h(Hints, { hint: 'Y forget · N keep', theme }),
    );
  else if (st.mode === 'edit')
    body = h(
      Box,
      { flexDirection: 'column' },
      h(Text, null, 'Edit this note'),
      h(
        Box,
        null,
        h(Text, muted, `${theme.symbols.prompt} `),
        h(Text, null, st.text),
        h(Text, accent ? { color: accent } : {}, theme.symbols.cursor),
      ),
      h(Text, muted, `${st.text.length}/${MEMORY_MAX_CHARS}`),
      h(Box, { height: 1 }),
      h(Hints, { hint: 'Enter save · Esc cancel', theme }),
    );
  else {
    // A window of rows around the highlighted one.
    const room = Math.max(3, (p.dialog?.rows ?? 24) - 10);
    const first = Math.max(0, Math.min(at - Math.floor(room / 2), entries.length - room));
    body = h(
      Box,
      { flexDirection: 'column' },
      ...entries.slice(first, first + room).map((e, j) => {
        const i = first + j;
        const text = e.text.length > width ? `${e.text.slice(0, width - 3)}...` : e.text;
        return h(
          Box,
          { key: e.id, justifyContent: 'space-between' },
          h(
            Text,
            i === at ? { bold: true, ...(accent ? { color: accent } : {}) } : {},
            `${i === at ? theme.symbols.prompt : ' '} ${text}`,
          ),
          h(Text, muted, ` ${KIND_LABEL[e.kind]}`),
        );
      }),
      h(Box, { height: 1 }),
      h(Hints, { hint: '↑↓ move · Enter edit · D forget · Shift+C forget all · Esc close', theme }),
    );
  }

  if (p.dialog)
    return h(Dialog, { title: 'What Remy remembers', theme, ...p.dialog, size: 'medium' }, body);
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: 1 },
    h(Text, { bold: true }, 'What Remy remembers'),
    h(Box, { height: 1 }),
    body,
  );
}
