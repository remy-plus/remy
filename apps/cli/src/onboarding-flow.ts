// The tour's controller: holds the step state, drives the chat for the login, model and first-task
// steps, and saves the profile when it ends. The screens only render `getState()` and call back.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Chat } from './chat.ts';
import { type FirstTask, firstTaskFor } from './goals.ts';
import {
  advance,
  type Facts,
  initialState,
  type OnboardingState,
  skipTask,
  skipTour,
} from './onboarding.ts';
import type { ProfileStore } from './profile.ts';

export interface OnboardingDeps {
  chat: Chat;
  profile: ProfileStore;
  /** Remembers that the tour was finished or skipped. */
  markDone: () => void;
  /** A new, empty scratch folder for the first task. */
  scratchDir: () => string;
}

export interface Onboarding {
  /** The tour in progress, or undefined when none is. */
  getState(): OnboardingState | undefined;
  subscribe(fn: () => void): () => void;
  /** Begins (or replays) the tour from the welcome screen, with the saved answers filled in. */
  start(): void;
  facts(): Facts;
  /** The task the answers so far lead to. */
  firstTask(): FirstTask;
  /** Welcome: on to the questions. */
  begin(): void;
  setName(name: string): void;
  setGoals(goals: string[]): void;
  setPersonalise(on: boolean): void;
  /** Makes the scratch folder and its sample files, and starts the first task there. */
  runTask(): void;
  /** The offer was passed over: on to the three keys. */
  passTask(): void;
  /** From the first task to the three keys, and from those to the end. */
  next(): void;
  /** Esc: the rest of the tour is skipped. */
  skip(): void;
}

export function createOnboarding(deps: OnboardingDeps): Onboarding {
  const { chat, profile } = deps;
  let st: OnboardingState | undefined;
  let ending = false;
  /** The first task's scratch folder, removed when the tour ends. */
  let scratch: string | undefined;
  /** Whether the conversation was empty when the tour began: only then is it cleared at the end. */
  let freshChat = true;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };

  const facts = (): Facts => {
    const cs = chat.getState();
    const choices = chat.models().length > 0;
    return { connected: Boolean(cs.model) || choices, hasModel: Boolean(cs.model), choices };
  };

  async function finish(): Promise<void> {
    const s = st;
    if (!s || ending) return;
    ending = true;
    try {
      // A skipped tour with nothing answered leaves no profile behind.
      if (s.name || s.goals.length || !s.skipped)
        profile.update({ name: s.name, goals: s.goals, personalise: s.personalise });
      deps.markDone();
      if (s.taskRan) {
        if (chat.getState().phase !== 'idle') await chat.interrupt();
        // The first task was practice: the home screen starts clean, unless /tour was replayed
        // over a conversation the user wants to keep.
        if (freshChat) await chat.runCommand('new');
      }
      chat.closeOverlay();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
      st = undefined;
      ending = false;
      notify();
    }
  }

  function enter(next: OnboardingState): void {
    st = next;
    if (next.step === 'done') {
      void finish();
      return;
    }
    if (next.step === 'provider') chat.openOverlay('login');
    if (next.step === 'model') chat.openOverlay('model');
    notify();
  }

  const go = () => st && enter(advance(st, facts()));

  /** The login and model steps are panels of the chat; their outcome shows in its state. */
  function reconcile(): void {
    if (!st || ending) return;
    const cs = chat.getState();
    const panelOpen = cs.overlay === 'login' || cs.overlay === 'model';
    if (st.step === 'provider') {
      // Saving a login without a default model opens the model list: that is the next step.
      if (cs.overlay === 'model') enter({ ...st, step: 'model' });
      else if (!panelOpen) {
        if (cs.model) go();
        else void finish();
      }
    } else if (st.step === 'model' && !panelOpen) {
      // The list closed, picked or not (Esc): the tour goes on, and skips the first task when
      // there is still no model to run it.
      go();
    }
  }
  chat.subscribe(reconcile);

  const ctl: Onboarding = {
    getState: () => st,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    start() {
      const p = profile.get();
      // The login panel the chat opens on its own belongs to the tour from here.
      chat.closeOverlay();
      ending = false;
      freshChat = chat.getState().items.length === 0;
      st = initialState(p && { name: p.name, goals: p.goals, personalise: p.personalise });
      notify();
    },
    facts,
    firstTask: () => firstTaskFor(st?.goals ?? []),
    begin: go,
    setName(name) {
      if (st) enter(advance({ ...st, name }, facts()));
    },
    setGoals(goals) {
      if (st) enter(advance({ ...st, goals }, facts()));
    },
    setPersonalise(on) {
      if (st) enter(advance({ ...st, personalise: on }, facts()));
    },
    runTask() {
      if (!st) return;
      const task = firstTaskFor(st.goals);
      const dir = deps.scratchDir();
      scratch = dir;
      mkdirSync(dir, { recursive: true });
      for (const f of task.files) {
        const path = join(dir, f.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, f.content);
      }
      st = { ...st, step: 'task', taskRan: true };
      notify();
      void chat.startTask(task.prompt, dir);
    },
    passTask() {
      if (st) enter(skipTask(st, facts()));
    },
    next: go,
    skip() {
      if (st) enter(skipTour(st));
    },
  };
  return ctl;
}
