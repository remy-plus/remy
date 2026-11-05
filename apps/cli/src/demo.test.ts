import type { ModelRequest } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { demoModel } from './demo.ts';

const req = (assistantTurns: number): ModelRequest => ({
  system: '',
  tools: [],
  maxOutputTokens: 100,
  temperature: 0,
  messages: [
    { role: 'user', content: 'Plan my week' },
    ...Array.from({ length: assistantTurns }, () => ({ role: 'assistant' as const, content: 'x' })),
  ],
});

describe('demoModel', () => {
  const model = demoModel(async () => {});

  it('plans, writes, then answers, the same on every take', async () => {
    const tools = [];
    for (const turn of [0, 1]) {
      const r = await model.complete(req(turn));
      tools.push(r.calls[0]?.tool);
    }
    expect(tools).toEqual(['update_plan', 'write_file']);
  });

  it('streams its answer word by word', async () => {
    const parts: string[] = [];
    const r = await model.complete(req(2), undefined, (d) => parts.push(d));
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.join('')).toBe(r.text);
    expect(r.calls).toEqual([]);
  });

  it('costs nothing', () => {
    expect(model.caps.pricing).toMatchObject({ inPerMTok: 0, outPerMTok: 0 });
  });
});
