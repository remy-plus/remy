// The onboarding tour as plain state: which step comes next, and the small reducers behind the
// text and goal questions. No Ink and no I/O, so every rule here is unit tested.
import { cleanCustomGoal, GOALS, MAX_CUSTOM_CHARS, MAX_GOALS } from './goals.ts';
import { cleanName, MAX_NAME_CHARS } from './profile.ts';

export type Step =
  | 'welcome'
  | 'name'
  | 'goals'
  | 'personalise'
  | 'provider'
  | 'model'
  | 'offer'
  | 'task'
  | 'keys'
  | 'done';

/** The order of the tour. Steps that do not apply are passed over. */
export const STEPS: readonly Step[] = [
  'welcome',
  'name',
  'goals',
  'personalise',
  'provider',
  'model',
  'offer',
  'task',
  'keys',
  'done',
];

export interface OnboardingState {
  step: Step;
  name: string;
  /** Known goal ids and typed goals. */
  goals: string[];
  personalise: boolean;
  /** Esc was pressed: the rest of the tour was skipped. */
  skipped: boolean;
  /** The first task was run, or offered and passed over. */
  taskRan: boolean;
}

/** What the tour needs to know about the world to pick its steps. */
export interface Facts {
  /** A provider is already connected, so the login step is passed over. */
  connected: boolean;
  /** A model is in use, so the first task can run. */
  hasModel: boolean;
  /** There are models to pick from; a key set only in the environment gives none. Default true. */
  choices?: boolean;
}

export const initialState = (prefill?: {
  name?: string;
  goals?: string[];
  personalise?: boolean;
}): OnboardingState => ({
  step: 'welcome',
  name: prefill?.name ?? '',
  goals: prefill?.goals ?? [],
  personalise: prefill?.personalise ?? true,
  skipped: false,
  taskRan: false,
});

/** Whether a step is shown, given the facts. */
export function applies(step: Step, facts: Facts): boolean {
  if (step === 'provider') return !facts.connected;
  if (step === 'model') return facts.choices !== false;
  if (step === 'offer' || step === 'task') return facts.hasModel;
  return true;
}

/** The step after `step` that applies. `done` is always last. */
export function nextStep(step: Step, facts: Facts): Step {
  for (const s of STEPS.slice(STEPS.indexOf(step) + 1)) if (applies(s, facts)) return s;
  return 'done';
}

/** Moves to the following step. */
export const advance = (s: OnboardingState, facts: Facts): OnboardingState => ({
  ...s,
  step: nextStep(s.step, facts),
});

/** Esc: the rest of the tour is skipped. What was answered so far is kept. */
export const skipTour = (s: OnboardingState): OnboardingState => ({
  ...s,
  step: 'done',
  skipped: true,
});

/** Passes the first task over and carries on to the three keys. */
export const skipTask = (s: OnboardingState, facts: Facts): OnboardingState => ({
  ...s,
  step: nextStep('task', facts),
});

/** "2 of 5": the position among the questions the user answers, for the welcome-free steps. */
export function progress(step: Step, facts: Facts): { at: number; of: number } | undefined {
  const shown = STEPS.filter((s) => s !== 'welcome' && s !== 'done' && applies(s, facts));
  const at = shown.indexOf(step);
  return at < 0 ? undefined : { at: at + 1, of: shown.length };
}

// ---------- the text question ----------

/** The keys the reducers read (a subset of Ink's `Key`). */
export interface StepKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  tab?: boolean;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips control input on purpose
const CONTROL = /\u001b\[20[01]~|[\x00-\x1f\x7f]/g;

/**
 * Typing into a one-line field. A paste arrives as one chunk: newlines and control characters are
 * dropped, so a pasted block never turns into several answers. Returns the new text.
 */
export function typeInto(value: string, input: string, key: StepKey, max: number): string {
  if (key.backspace || key.delete) return value.slice(0, -1);
  if (key.ctrl || key.meta || key.return || key.escape || key.tab) return value;
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return value;
  const clean = input.replace(CONTROL, '');
  return clean ? (value + clean).slice(0, max) : value;
}

export type TextStep = { state: string; done?: undefined } | { state: string; done: string };

/** One key in the name question: Enter finishes with the cleaned name (blank is allowed). */
export function nameKey(value: string, input: string, key: StepKey): TextStep {
  if (key.return) return { state: value, done: cleanName(value) };
  return { state: typeInto(value, input, key, MAX_NAME_CHARS) };
}

// ---------- the goals question ----------

/** Rows: one per goal, then "Something else" where the user types their own. */
export const GOAL_ROWS = GOALS.length + 1;
export const CUSTOM_ROW = GOALS.length;

export interface GoalsState {
  at: number;
  picked: string[];
  custom: string;
}

export const goalsStart = (goals: readonly string[] = []): GoalsState => {
  const known = new Set(GOALS.map((g) => g.id));
  return {
    at: 0,
    picked: goals.filter((g) => known.has(g)),
    custom: goals.find((g) => !known.has(g)) ?? '',
  };
};

/** The goals the state stands for: the picks in the order of the list, then the typed one. */
export function goalsOf(s: GoalsState): string[] {
  const picked = GOALS.map((g) => g.id).filter((id) => s.picked.includes(id));
  const typed = cleanCustomGoal(s.custom);
  return typed ? [...picked, typed].slice(0, MAX_GOALS) : picked;
}

export type GoalsStep =
  | { state: GoalsState; done?: undefined }
  | { state: GoalsState; done: string[] };

/**
 * One key in the goals question. Up and down move, Space picks, and typing on any row writes the
 * "Something else" line. Enter finishes, with none picked if that is the answer.
 */
export function goalsKey(s: GoalsState, input: string, key: StepKey): GoalsStep {
  if (key.return) return { state: s, done: goalsOf(s) };
  if (key.upArrow) return { state: { ...s, at: (s.at + GOAL_ROWS - 1) % GOAL_ROWS } };
  if (key.downArrow || key.tab) return { state: { ...s, at: (s.at + 1) % GOAL_ROWS } };
  if (input === ' ' && s.at < CUSTOM_ROW) {
    const id = GOALS[s.at]?.id as string;
    const picked = s.picked.includes(id) ? s.picked.filter((p) => p !== id) : [...s.picked, id];
    return { state: { ...s, picked } };
  }
  if (key.backspace || key.delete) {
    return s.custom
      ? { state: { ...s, at: CUSTOM_ROW, custom: s.custom.slice(0, -1) } }
      : { state: s };
  }
  if (key.ctrl || key.meta || key.leftArrow || key.rightArrow) return { state: s };
  const custom = typeInto(s.custom, input, key, MAX_CUSTOM_CHARS);
  return custom === s.custom ? { state: s } : { state: { ...s, at: CUSTOM_ROW, custom } };
}

// ---------- the yes or no question ----------

export type YesNoStep = { state: boolean; done?: undefined } | { state: boolean; done: boolean };

/** Y and N answer at once; arrows and Tab switch the choice; Enter takes the one shown. */
export function yesNoKey(value: boolean, input: string, key: StepKey): YesNoStep {
  if (key.return) return { state: value, done: value };
  if (!key.ctrl && !key.meta) {
    const c = input.toLowerCase();
    if (c === 'y') return { state: true, done: true };
    if (c === 'n') return { state: false, done: false };
  }
  if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.tab)
    return { state: !value };
  return { state: value };
}

// ---------- the model step ----------

/**
 * The model to highlight in the tour's list: the default of the provider in use (they are the
 * cheap ones), then of any other connected provider, else the model in use, else the first.
 */
export function cheapChoice<T extends { provider: string; model: string }>(
  choices: readonly T[],
  active: string | undefined,
  defaultFor: (provider: string) => string | undefined,
): T | undefined {
  const inUse = choices.find((c) => c.model === active);
  const ordered = inUse
    ? [
        inUse,
        ...choices.filter((c) => c.provider === inUse.provider && c !== inUse),
        ...choices.filter((c) => c.provider !== inUse.provider),
      ]
    : [...choices];
  return ordered.find((c) => c.model === defaultFor(c.provider)) ?? inUse ?? choices[0];
}
