import { ModelError } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { describe, expect, it } from 'vitest';
import { createModelSlot, EMPTY_SLOT_MESSAGE } from './model-slot.ts';

const req = { system: '', messages: [], tools: [], temperature: 0, maxOutputTokens: 1 };
const answer = { calls: [], text: 'hi', usage: { inTokens: 1, outTokens: 1 } };

describe('model slot', () => {
  it('starts empty: not ready, and a call fails like a model that cannot be reached', async () => {
    const slot = createModelSlot();
    expect(slot.ready()).toBe(false);
    expect(slot.client.id).toBe('none');
    const e = await slot.client.complete(req, new AbortController().signal).catch((x) => x);
    expect(e).toBeInstanceOf(ModelError);
    expect(e.unreachable).toBe(true);
    expect(e.retryable).toBe(false);
    expect(e.message).toBe(EMPTY_SLOT_MESSAGE);
  });

  it('follows the model put in it, including for a client handed out earlier', async () => {
    const slot = createModelSlot();
    const handedOut = slot.client;
    slot.set(new ScriptedModelClient([answer], { id: 'first' }));
    expect(slot.ready()).toBe(true);
    expect(handedOut.id).toBe('first');
    expect((await handedOut.complete(req, new AbortController().signal)).text).toBe('hi');
    slot.set(new ScriptedModelClient([answer], { id: 'second' }));
    expect(handedOut.id).toBe('second');
  });

  it('can start filled', () => {
    expect(createModelSlot(new ScriptedModelClient([], { id: 'x' })).ready()).toBe(true);
  });
});
