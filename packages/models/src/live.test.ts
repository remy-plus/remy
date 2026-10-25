import { describe, expect, it } from 'vitest';
import { modelFromEnv } from './config.ts';

// Run with: REMY_LIVE=1 REMY_PROFILE=ollama REMY_MODEL=llama3.1 pnpm vitest run packages/models
describe.skipIf(process.env.REMY_LIVE !== '1')('live smoke', () => {
  it('gets a tool call from a real model', async () => {
    const client = modelFromEnv(process.env);
    const res = await client.complete(
      {
        system: 'You are a helpful agent. Always act by calling a tool.',
        messages: [{ role: 'user', content: 'Call the finish tool with answer "ok".' }],
        tools: [
          {
            name: 'finish',
            description: 'Finish the task with an answer',
            parameters: {
              type: 'object',
              properties: { answer: { type: 'string' } },
              required: ['answer'],
            },
          },
        ],
        maxOutputTokens: 256,
        temperature: 0,
      },
      AbortSignal.timeout(120_000),
    );
    expect(res.calls[0]?.tool).toBe('finish');
  }, 130_000);
});
