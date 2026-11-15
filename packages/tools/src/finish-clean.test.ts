import { describe, expect, it } from 'vitest';
import { cleanAnswer } from './file-tools.ts';

describe('cleanAnswer', () => {
  it('drops tool-call markup a model left at the end, as seen live', () => {
    expect(cleanAnswer('Sony dropped to $248.</answer>\n</invoke>\n')).toBe(
      'Sony dropped to $248.',
    );
    expect(cleanAnswer('<answer>Hi.</answer>')).toBe('Hi.');
  });

  it('keeps tags inside an answer', () => {
    const t = 'Wrap it in <answer> and </answer> tags, then send it.';
    expect(cleanAnswer(t)).toBe(t);
  });
});
