import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, type MemoryEntry } from '@remy/tools';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createChat, releaseLease } from './chat.ts';
import { findCommand, matchCommands } from './commands.ts';
import { openMemory } from './memory.ts';
import { MemoryPanel, memoryKey, memoryStart } from './memory-ui.ts';
import { createTheme } from './theme.ts';

const theme = createTheme('none');
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const entry = (id: string, text: string): MemoryEntry => ({
  id,
  text,
  kind: 'preference',
  source: '',
  created: '2026-01-01',
});
const two = [entry('mem_a', 'Likes tea'), entry('mem_b', 'Writes in metric')];
const store = () => {
  let t = 0;
  const m = openMemory(mkdtempSync(join(tmpdir(), 'remy-mu-')), {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
  });
  m.add({ text: 'Likes tea', kind: 'preference', source: '' });
  m.add({ text: 'Lives in Lisbon', kind: 'about_you', source: '' });
  return m;
};

describe('memory keys', () => {
  it('moves, and closes with Esc', () => {
    let r = memoryKey(memoryStart(), '', { downArrow: true }, two);
    expect(r.state.at).toBe(1);
    r = memoryKey(r.state, '', { downArrow: true }, two);
    expect(r.state.at).toBe(0);
    expect(memoryKey(r.state, '', { escape: true }, two).action).toEqual({ type: 'close' });
  });

  it('edits: Enter opens the note, typing changes it, Enter saves, Esc cancels', () => {
    let r = memoryKey(memoryStart(), '', { return: true }, two);
    expect(r.state).toMatchObject({ mode: 'edit', text: 'Likes tea' });
    r = memoryKey(r.state, '!', {}, two);
    r = memoryKey(r.state, '', { backspace: true }, two);
    r = memoryKey(r.state, ' a lot', {}, two);
    expect(memoryKey(r.state, '', { return: true }, two).action).toEqual({
      type: 'save',
      id: 'mem_a',
      text: 'Likes tea a lot',
    });
    const cancel = memoryKey(r.state, '', { escape: true }, two);
    expect(cancel.state.mode).toBe('list');
    expect(cancel.action).toBeUndefined();
    const blank = memoryKey({ ...r.state, text: '  ' }, '', { return: true }, two);
    expect(blank.action).toBeUndefined();
  });

  it('caps the length of an edited note', () => {
    const r = memoryKey({ mode: 'edit', at: 0, text: 'x'.repeat(199) }, 'yyyy', {}, two);
    expect(r.state.text).toHaveLength(200);
  });

  it('deletes only after a yes, never on Enter', () => {
    const ask = memoryKey({ ...memoryStart(), at: 1 }, 'd', {}, two);
    expect(ask.state.mode).toBe('delete');
    expect(ask.action).toBeUndefined();
    expect(memoryKey(ask.state, '', { return: true }, two).action).toBeUndefined();
    expect(memoryKey(ask.state, 'n', {}, two).state.mode).toBe('list');
    expect(memoryKey(ask.state, 'y', {}, two).action).toEqual({ type: 'delete', id: 'mem_b' });
  });

  it('clears all only after a yes', () => {
    const ask = memoryKey(memoryStart(), 'C', {}, two);
    expect(ask.state.mode).toBe('clear');
    expect(memoryKey(ask.state, 'y', {}, two).action).toEqual({ type: 'clear' });
    expect(memoryKey(ask.state, '', { escape: true }, two).action).toBeUndefined();
  });

  it('does nothing on an empty list but close', () => {
    expect(memoryKey(memoryStart(), '', { return: true }, []).state.mode).toBe('list');
    expect(memoryKey(memoryStart(), 'd', {}, []).state.mode).toBe('list');
  });
});

describe('memory panel', () => {
  it('lists notes newest first in both layouts, and the empty state', () => {
    for (const dialog of [{ columns: 100, rows: 30 }, undefined]) {
      const out =
        render(
          h(
            Box,
            { width: dialog?.columns ?? 80, height: 24 },
            h(MemoryPanel, { store: store(), theme, dialog, onClose: () => {} }),
          ),
        ).lastFrame() ?? '';
      expect(out).toContain('What Remy remembers');
      expect(out.indexOf('Lives in Lisbon')).toBeLessThan(out.indexOf('Likes tea'));
      expect(out).toContain('Enter edit');
      expect(out).not.toContain('!');
    }
    const empty = openMemory(mkdtempSync(join(tmpdir(), 'remy-mu-')));
    const out =
      render(h(MemoryPanel, { store: empty, theme, onClose: () => {} })).lastFrame() ?? '';
    expect(out).toContain('Nothing saved yet.');
  });

  it('deletes a note after y and edits another', async () => {
    const s = store();
    const onClose = vi.fn();
    const r = render(h(MemoryPanel, { store: s, theme, onClose }));
    await tick();
    r.stdin.write('d');
    await tick();
    expect(r.lastFrame()).toContain('Forget this note?');
    r.stdin.write('y');
    await tick();
    expect(s.list().map((e) => e.text)).toEqual(['Likes tea']);
    r.stdin.write('\r');
    await tick();
    r.stdin.write(' please');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(s.list()[0]?.text).toBe('Likes tea please');
    r.stdin.write('\x1b');
    await tick(60);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('/memory in the chat', () => {
  function chatWith(m = store(), personalise = true) {
    const events = new MemoryEventStore();
    const model = new ScriptedModelClient([]);
    return createChat({
      runtime: (hooks) =>
        createRuntime({
          store: events,
          model,
          tools: new ToolRegistry([]),
          owner: 't',
          capabilities: () => ({
            fs: createScopedFs(tmpdir()),
            net: createScopedFetch({}),
            secrets: { get: () => undefined },
          }),
          sleep: async () => {},
          ...hooks,
        }),
      config: (context) => ({
        model: 'x',
        permissions: { autoApprove: ['read'] },
        budget: DEFAULT_BUDGET,
        workspaceDir: tmpdir(),
        context,
      }),
      listTasks: () => events.listTasks(),
      readEvents: (id) => events.read(id),
      release: releaseLease(events, 't'),
      memory: { store: m, personalise: () => personalise },
    });
  }
  const notes = (c: ReturnType<typeof chatWith>) =>
    c.getState().items.flatMap((i) => (i.kind === 'note' || i.kind === 'error' ? [i.text] : []));

  it('opens the dialog when there are notes and says so when there are none', async () => {
    const c = chatWith();
    await c.submit('/memory');
    expect(c.getState().overlay).toBe('memory');
    const empty = chatWith(openMemory(mkdtempSync(join(tmpdir(), 'remy-mu-'))));
    await empty.submit('/memory');
    expect(empty.getState().overlay).toBeUndefined();
    expect(notes(empty)[0]).toContain('has not saved anything');
  });

  it('prints a plain list, forgets by id and reports unknown ids', async () => {
    const m = store();
    const id = m.list()[0]?.id as string;
    const c = chatWith(m, false);
    await c.submit('/memory list');
    expect(notes(c)[0]).toContain('Lives in Lisbon');
    expect(notes(c)[0]).toContain('Personalise replies');
    await c.submit(`/memory forget ${id}`);
    expect(m.list()).toHaveLength(1);
    await c.submit('/memory forget mem_zzz');
    await c.submit('/memory forget');
    expect(notes(c).slice(1)).toEqual([
      `Forgot ${id}.`,
      'There is no saved note mem_zzz.',
      'Use /memory forget <id>.',
    ]);
  });

  it('is a listed command, in the palette and /help', () => {
    expect(findCommand('memory')?.summary).toContain('remembers');
    expect(matchCommands('memo')[0]?.name).toBe('memory');
  });
});
