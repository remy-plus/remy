import type { ModelRequest } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { HOWTO_NOTE } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import { CASES } from './cases/index.ts';
import { createWorld, withCorrectionNote } from './world.ts';

const req = (...users: string[]): ModelRequest => ({
  system: 's',
  messages: users.flatMap((u, i) => [
    { role: 'user' as const, content: u },
    ...(i < users.length - 1 ? [{ role: 'assistant' as const, content: `a${i}` }] : []),
  ]),
  tools: [],
  maxOutputTokens: 10,
  temperature: 0,
});
const sig = new AbortController().signal;
const usage = { inTokens: 1, outTokens: 1 };

describe('how-tos in the eval world', () => {
  it('marks a correction of an earlier answer and nothing else', async () => {
    const inner = new ScriptedModelClient([
      { text: 'x', calls: [], usage },
      { text: 'x', calls: [], usage },
    ]);
    const m = withCorrectionNote(inner);
    await m.complete(req('find it', 'No, use the other folder'), sig);
    await m.complete(req('find it', 'and the other one?'), sig);
    expect(JSON.stringify(inner.requests[0]?.messages)).toContain(HOWTO_NOTE.slice(0, 30));
    expect(JSON.stringify(inner.requests[1]?.messages)).not.toContain(HOWTO_NOTE.slice(0, 30));
  });

  it('offers save_howto only while personalising is on', async () => {
    const on = CASES.find((c) => c.id === 'howto-offer-after-correction');
    const off = CASES.find((c) => c.id === 'howto-personalising-off-no-offer');
    if (!on || !off) throw new Error('cases missing');
    const [a, b] = [await createWorld(on), await createWorld(off)];
    expect(a.tools.map((t) => t.name)).toContain('save_howto');
    expect(a.system).toContain('save_howto');
    expect(b.tools.map((t) => t.name)).not.toContain('save_howto');
    await a.cleanup();
    await b.cleanup();
  });
});
