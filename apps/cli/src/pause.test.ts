import { DEFAULT_BUDGET } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { defaultMore, pauseQuestion } from './pause.ts';

const more = defaultMore({ initialBudget: DEFAULT_BUDGET });

describe('pauseQuestion', () => {
  it('words a budget pause by what ran out', () => {
    expect(pauseQuestion({ status: 'paused', limit: 'steps', steps: 30, costUsd: 0.4 }, more)).toBe(
      'Paused after 30 steps and $0.40. Continue for 30 more steps?',
    );
  });

  it('says the task is saved when the model could not be reached, and offers no extra budget', () => {
    const q = pauseQuestion({ status: 'paused', limit: 'model', steps: 1, costUsd: 0 }, more);
    expect(q).toBe(
      'Remy lost contact with the model after 1 step and $0.00. The task is saved. Continue once you are back online?',
    );
    expect(q).not.toMatch(/more steps/);
  });
});
