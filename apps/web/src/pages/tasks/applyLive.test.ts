import { describe, expect, it } from 'vitest';
import { applyLive } from './useTask.ts';

describe('applyLive', () => {
  it('grows the text of one kind', () => {
    let t = applyLive(null, { kind: 'answer', delta: 'Hel' });
    t = applyLive(t, { kind: 'answer', delta: 'lo' });
    expect(t).toEqual({ kind: 'answer', text: 'Hello' });
  });
  it('starts over when the kind changes or a new call begins', () => {
    const t = applyLive({ kind: 'text', text: 'Let me check.' }, { kind: 'answer', delta: 'Done' });
    expect(t).toEqual({ kind: 'answer', text: 'Done' });
    expect(applyLive(t, { kind: 'start' })).toBeNull();
  });
  it('replaces everything on a set', () => {
    expect(
      applyLive(
        { kind: 'answer', text: 'key sk-12' },
        { kind: 'set', of: 'answer', text: 'key [hidden]' },
      ),
    ).toEqual({ kind: 'answer', text: 'key [hidden]' });
  });
});
