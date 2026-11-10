import { describe, expect, it } from 'vitest';
import { chunkText, frameLevel, ON_SCREEN, smoothLevel, speakable } from './voice.ts';

describe('speakable', () => {
  it('speaks a short answer in plain words', () => {
    expect(speakable('I **booked** the [table](https://x.test) for 7pm.')).toEqual([
      'I booked the table for 7pm.',
    ]);
  });
  it('leaves code on screen and says so', () => {
    const out = speakable('Here is the fix.\n```ts\nconst a = 1;\n```\nRun it again.');
    expect(out.join(' ')).not.toContain('const');
    expect(out.at(-1)).toBe(ON_SCREEN);
  });
  it('leaves a long list on screen', () => {
    const out = speakable('Found these:\n- a\n- b\n- c\n- d\n- e');
    expect(out).toEqual(['Found these:', ON_SCREEN]);
  });
  it('cuts a long answer at a sentence', () => {
    const out = speakable('One sentence here. '.repeat(60));
    expect(out.at(-1)).toBe(ON_SCREEN);
    expect(out.every((c) => c.length <= 180)).toBe(true);
  });
});

describe('levels', () => {
  it('chunks at sentence ends', () => {
    expect(chunkText('First one. Second one.', 12)).toEqual(['First one.', 'Second one.']);
  });
  it('reads silence as 0 and a loud wave as high', () => {
    expect(frameLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(frameLevel(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1);
  });
  it('rises fast and falls slowly', () => {
    expect(smoothLevel(0, 1)).toBeCloseTo(0.6);
    expect(smoothLevel(1, 0)).toBeCloseTo(0.85);
  });
});
