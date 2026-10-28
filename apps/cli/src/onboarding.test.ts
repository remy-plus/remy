import { describe, expect, it } from 'vitest';
import {
  advance,
  applies,
  CUSTOM_ROW,
  cheapChoice,
  type Facts,
  goalsKey,
  goalsOf,
  goalsStart,
  initialState,
  nameKey,
  nextStep,
  progress,
  skipTask,
  skipTour,
  typeInto,
  yesNoKey,
} from './onboarding.ts';

const fresh: Facts = { connected: false, hasModel: false };
const ready: Facts = { connected: true, hasModel: true };

describe('step order', () => {
  it('walks the whole tour when nothing is connected', () => {
    const seen: string[] = [];
    let step = initialState().step;
    while (step !== 'done') {
      seen.push(step);
      step = nextStep(step, { ...fresh, hasModel: seen.includes('model') });
    }
    expect(seen).toEqual([
      'welcome',
      'name',
      'goals',
      'personalise',
      'provider',
      'model',
      'offer',
      'task',
      'keys',
    ]);
  });

  it('passes over the login when a provider is connected', () => {
    expect(nextStep('personalise', ready)).toBe('model');
    expect(applies('provider', ready)).toBe(false);
  });

  it('passes over the model list when there is nothing to pick from', () => {
    expect(nextStep('personalise', { connected: true, hasModel: true, choices: false })).toBe(
      'offer',
    );
  });

  it('passes over the first task when no model is in use', () => {
    expect(nextStep('model', { connected: true, hasModel: false })).toBe('keys');
  });

  it('ends on done', () => {
    expect(nextStep('keys', ready)).toBe('done');
    expect(nextStep('done', ready)).toBe('done');
  });

  it('advance keeps the answers', () => {
    const s = { ...initialState(), name: 'Sam', step: 'name' as const };
    expect(advance(s, ready)).toMatchObject({ step: 'goals', name: 'Sam' });
  });

  it('skipping ends the tour and keeps what was answered', () => {
    const s = { ...initialState({ name: 'Sam' }), step: 'goals' as const };
    expect(skipTour(s)).toMatchObject({ step: 'done', skipped: true, name: 'Sam' });
  });

  it('skipping the task still shows the keys', () => {
    const s = { ...initialState(), step: 'offer' as const };
    expect(skipTask(s, ready).step).toBe('keys');
  });

  it('counts only the questions that are shown', () => {
    expect(progress('welcome', fresh)).toBeUndefined();
    expect(progress('name', ready)).toEqual({ at: 1, of: 7 });
    expect(progress('model', ready)).toEqual({ at: 4, of: 7 });
    expect(progress('provider', { connected: false, hasModel: true })).toEqual({ at: 4, of: 8 });
  });
});

describe('typing', () => {
  it('appends, deletes and caps', () => {
    expect(typeInto('Sa', 'm', {}, 10)).toBe('Sam');
    expect(typeInto('Sam', '', { backspace: true }, 10)).toBe('Sa');
    expect(typeInto('abcd', 'ef', {}, 5)).toBe('abcde');
  });
  it('drops newlines, control characters and bracketed-paste markers', () => {
    expect(typeInto('', '\u001b[200~Sam\nLee\u001b[201~', {}, 40)).toBe('SamLee');
    expect(typeInto('Sam', '\t\u0007', {}, 40)).toBe('Sam');
  });
  it('ignores shortcuts and arrows', () => {
    expect(typeInto('Sam', 'a', { ctrl: true }, 40)).toBe('Sam');
    expect(typeInto('Sam', '', { leftArrow: true }, 40)).toBe('Sam');
  });
});

describe('name question', () => {
  it('finishes on Enter with a cleaned name, blank allowed', () => {
    expect(nameKey('  Sam <b> ', '', { return: true })).toEqual({
      state: '  Sam <b> ',
      done: 'Sam b',
    });
    expect(nameKey('', '', { return: true }).done).toBe('');
    expect(nameKey('Sa', 'm', {})).toEqual({ state: 'Sam' });
  });
});

describe('goals question', () => {
  it('moves, wrapping around', () => {
    let s = goalsStart();
    s = goalsKey(s, '', { upArrow: true }).state;
    expect(s.at).toBe(CUSTOM_ROW);
    s = goalsKey(s, '', { downArrow: true }).state;
    expect(s.at).toBe(0);
  });

  it('picks several with Space and gives them in list order', () => {
    let s = goalsStart();
    s = goalsKey(s, ' ', {}).state; // work
    s = goalsKey(s, '', { downArrow: true }).state;
    s = goalsKey(s, '', { downArrow: true }).state;
    s = goalsKey(s, ' ', {}).state; // files
    s = goalsKey(s, '', { upArrow: true }).state;
    s = goalsKey(s, '', { upArrow: true }).state;
    s = goalsKey(s, ' ', {}).state; // work again: unpicked
    expect(goalsOf(s)).toEqual(['files']);
    s = goalsKey(s, ' ', {}).state; // picks work back
    expect(goalsOf(s)).toEqual(['work', 'files']);
  });

  it('typing on any row writes the own-words line', () => {
    let s = goalsStart();
    for (const c of 'garden') s = goalsKey(s, c, {}).state;
    expect(s.at).toBe(CUSTOM_ROW);
    expect(s.custom).toBe('garden');
    s = goalsKey(s, '', { backspace: true }).state;
    expect(s.custom).toBe('garde');
    expect(goalsOf(s)).toEqual(['garde']);
  });

  it('Space types into the own-words line once there', () => {
    let s = { ...goalsStart(), at: CUSTOM_ROW, custom: 'plan' };
    s = goalsKey(s, ' ', {}).state;
    s = goalsKey(s, 'x', {}).state;
    expect(s.custom).toBe('plan x');
  });

  it('Enter finishes, even with nothing picked', () => {
    expect(goalsKey(goalsStart(), '', { return: true }).done).toEqual([]);
    const s = { ...goalsStart(['coding']), custom: 'robots' };
    expect(goalsKey(s, '', { return: true }).done).toEqual(['coding', 'robots']);
  });

  it('starts from saved goals, known and typed', () => {
    const s = goalsStart(['school', 'baking']);
    expect(s.picked).toEqual(['school']);
    expect(s.custom).toBe('baking');
  });

  it('cleans the typed line on the way out', () => {
    const s = { ...goalsStart(), custom: 'a<b>c' };
    expect(goalsOf(s)).toEqual(['a b c']);
  });
});

describe('yes or no question', () => {
  it('answers with y and n, or switches and confirms', () => {
    expect(yesNoKey(true, 'n', {})).toEqual({ state: false, done: false });
    expect(yesNoKey(false, 'Y', {})).toEqual({ state: true, done: true });
    expect(yesNoKey(true, '', { rightArrow: true })).toEqual({ state: false });
    expect(yesNoKey(false, '', { return: true })).toEqual({ state: false, done: false });
    expect(yesNoKey(true, 'x', {})).toEqual({ state: true });
  });
});

describe('the model to highlight', () => {
  const defaults: Record<string, string> = { openai: 'gpt-5-nano', anthropic: 'claude-haiku-5-5' };
  const defaultFor = (p: string) => defaults[p];
  const list = [
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-5-nano' },
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'anthropic', model: 'claude-haiku-5-5' },
  ];
  it('picks the cheap default of the provider in use', () => {
    expect(cheapChoice(list, 'gpt-4o', defaultFor)?.model).toBe('gpt-5-nano');
    expect(cheapChoice(list, 'claude-sonnet-5-5', defaultFor)?.model).toBe('claude-haiku-5-5');
  });
  it('falls back to the model in use, then the first', () => {
    expect(cheapChoice(list, 'gpt-4o', () => undefined)?.model).toBe('gpt-4o');
    expect(cheapChoice(list, undefined, () => undefined)?.model).toBe('gpt-4o');
    expect(cheapChoice(list, undefined, defaultFor)?.model).toBe('gpt-5-nano');
    expect(cheapChoice([], undefined, defaultFor)).toBeUndefined();
  });
});
