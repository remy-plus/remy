import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Chat, ChatState, Overlay } from './chat.ts';
import { createOnboarding } from './onboarding-flow.ts';
import { createProfileStore } from './profile.ts';

/** Just enough of the chat for the tour: state, overlays, models and the first task. */
function fakeChat(init: { model?: string; saved?: number; overlay?: Overlay } = {}) {
  let s = {
    phase: 'idle',
    items: [] as unknown[],
    model: init.model,
    overlay: init.overlay,
  } as unknown as ChatState;
  const listeners = new Set<() => void>();
  const set = (patch: Record<string, unknown>) => {
    s = { ...s, ...patch } as ChatState;
    for (const fn of [...listeners]) fn();
  };
  const calls: string[] = [];
  const chat = {
    getState: () => s,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    models: () =>
      Array.from({ length: init.saved ?? 0 }, (_, i) => ({
        provider: 'p',
        model: `m${i}`,
        detail: '',
      })),
    openOverlay: (o: Overlay) => set({ overlay: o }),
    closeOverlay: (only?: Overlay) => {
      if (!only || s.overlay === only) set({ overlay: undefined });
    },
    startTask: vi.fn(async (prompt: string, dir: string) => {
      calls.push(`task:${prompt}@${dir}`);
      set({ phase: 'running' });
    }),
    interrupt: vi.fn(async () => {
      calls.push('interrupt');
      set({ phase: 'idle' });
    }),
    runCommand: vi.fn(async (name: string) => {
      calls.push(`cmd:${name}`);
    }),
  } as unknown as Chat;
  return { chat, set, calls };
}

function setup(init: Parameters<typeof fakeChat>[0] = {}) {
  const home = mkdtempSync(join(tmpdir(), 'remy-tour-'));
  const f = fakeChat(init);
  const profile = createProfileStore(home);
  const markDone = vi.fn();
  const scratch = join(home, 'workspaces', 'tour_1');
  const ob = createOnboarding({ chat: f.chat, profile, markDone, scratchDir: () => scratch });
  return { ...f, ob, profile, markDone, home, scratch };
}
const step = (ob: ReturnType<typeof setup>['ob']) => ob.getState()?.step;
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('the tour with a provider already connected', () => {
  it('walks every step and saves the profile at the end', async () => {
    const t = setup({ model: 'gpt-5-nano', saved: 1 });
    t.ob.start();
    expect(step(t.ob)).toBe('welcome');
    t.ob.begin();
    expect(step(t.ob)).toBe('name');
    t.ob.setName('Sam');
    expect(step(t.ob)).toBe('goals');
    t.ob.setGoals(['files', 'my own thing']);
    expect(step(t.ob)).toBe('personalise');
    t.ob.setPersonalise(false);
    // The login is passed over; the model list opens with the user's model.
    expect(step(t.ob)).toBe('model');
    expect(t.chat.getState().overlay).toBe('model');
    // Picking a model closes the list after a note is added to the transcript.
    t.set({ items: [{ kind: 'note' }] });
    t.set({ overlay: undefined });
    expect(step(t.ob)).toBe('offer');
    expect(t.ob.firstTask().prompt).toBe('Tidy these files into folders by type');
    t.ob.runTask();
    expect(step(t.ob)).toBe('task');
    expect(t.calls[0]).toBe(`task:Tidy these files into folders by type@${t.scratch}`);
    expect(readdirSync(t.scratch)).toHaveLength(6);
    t.ob.next();
    expect(step(t.ob)).toBe('keys');
    t.ob.next();
    await settle();
    expect(t.ob.getState()).toBeUndefined();
    expect(t.profile.get()).toMatchObject({
      name: 'Sam',
      goals: ['files', 'my own thing'],
      personalise: false,
    });
    expect(t.markDone).toHaveBeenCalledOnce();
    // The practice task is stopped and the home screen starts clean.
    expect(t.calls.slice(1)).toEqual(['interrupt', 'cmd:new']);
  });

  it('can pass the task over and still see the keys, leaving the conversation alone', async () => {
    const t = setup({ model: 'm', saved: 1 });
    t.ob.start();
    t.ob.begin();
    t.ob.setName('');
    t.ob.setGoals(['research']);
    t.ob.setPersonalise(true);
    t.set({ items: [{ kind: 'note' }] });
    t.set({ overlay: undefined });
    expect(step(t.ob)).toBe('offer');
    t.ob.passTask();
    expect(step(t.ob)).toBe('keys');
    t.ob.next();
    await settle();
    expect(t.calls).toEqual([]);
    expect(t.profile.get()?.goals).toEqual(['research']);
    expect(existsSync(t.scratch)).toBe(false);
  });

  it('Esc in the model list skips the rest', async () => {
    const t = setup({ model: 'm', saved: 1 });
    t.ob.start();
    t.ob.begin();
    t.ob.setName('Ana');
    t.ob.setGoals([]);
    t.ob.setPersonalise(true);
    expect(step(t.ob)).toBe('model');
    t.set({ overlay: undefined });
    await settle();
    expect(t.ob.getState()).toBeUndefined();
    expect(t.markDone).toHaveBeenCalled();
    expect(t.profile.get()?.name).toBe('Ana');
  });
});

describe('the tour on a first run', () => {
  it('closes the login the chat opens by itself, then opens it at its step', () => {
    const t = setup({ overlay: 'login', saved: 0 });
    t.ob.start();
    expect(t.chat.getState().overlay).toBeUndefined();
    t.ob.begin();
    t.ob.setName('Sam');
    t.ob.setGoals([]);
    t.ob.setPersonalise(true);
    expect(step(t.ob)).toBe('provider');
    expect(t.chat.getState().overlay).toBe('login');
  });

  it('moves on to the model list once a login with a model is saved', () => {
    const t = setup({ saved: 0 });
    t.ob.start();
    t.ob.begin();
    t.ob.setName('');
    t.ob.setGoals([]);
    t.ob.setPersonalise(true);
    // saveLogin sets the model and a note; the panel then closes itself.
    t.set({ model: 'gpt-5-nano', items: [{ kind: 'note' }] });
    expect(step(t.ob)).toBe('provider');
    t.set({ overlay: undefined });
    expect(step(t.ob)).toBe('model');
    expect(t.chat.getState().overlay).toBe('model');
  });

  it('a login without a default model goes straight to the model list', () => {
    const t = setup({ saved: 0 });
    t.ob.start();
    t.ob.begin();
    t.ob.setName('');
    t.ob.setGoals([]);
    t.ob.setPersonalise(true);
    t.set({ overlay: 'model', items: [{ kind: 'note' }] });
    expect(step(t.ob)).toBe('model');
  });

  it('cancelling the login skips the rest and leaves the answers', async () => {
    const t = setup({ saved: 0 });
    t.ob.start();
    t.ob.begin();
    t.ob.setName('Sam');
    t.ob.setGoals(['coding']);
    t.ob.setPersonalise(true);
    t.set({ overlay: undefined });
    await settle();
    expect(t.ob.getState()).toBeUndefined();
    expect(t.profile.get()).toMatchObject({ name: 'Sam', goals: ['coding'] });
    expect(t.markDone).toHaveBeenCalled();
  });
});

describe('skipping', () => {
  it('Esc at the welcome marks the tour done and keeps no profile', async () => {
    const t = setup({ model: 'm', saved: 1 });
    t.ob.start();
    t.ob.skip();
    await settle();
    expect(t.ob.getState()).toBeUndefined();
    expect(t.profile.get()).toBeUndefined();
    expect(t.markDone).toHaveBeenCalledOnce();
  });

  it('Esc during the first task stops it and returns home', async () => {
    const t = setup({ model: 'm', saved: 1 });
    t.ob.start();
    t.ob.begin();
    t.ob.setName('Sam');
    t.ob.setGoals(['school']);
    t.ob.setPersonalise(true);
    t.set({ items: [{ kind: 'note' }] });
    t.set({ overlay: undefined });
    t.ob.runTask();
    t.ob.skip();
    await settle();
    expect(t.calls.slice(-2)).toEqual(['interrupt', 'cmd:new']);
    expect(t.profile.get()?.name).toBe('Sam');
  });
});

describe('replay', () => {
  it('starts from the saved answers', () => {
    const t = setup({ model: 'm', saved: 1 });
    t.profile.update({ name: 'Sam', goals: ['coding'], personalise: false });
    t.ob.start();
    expect(t.ob.getState()).toMatchObject({ name: 'Sam', goals: ['coding'], personalise: false });
  });
});
