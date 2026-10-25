import type { ModelClient } from '@remy/core';
import { DEFAULT_CAPS } from '@remy/models';
import type { Move } from './types.ts';

/**
 * Plays a case's reference plan. The move is picked by how many assistant turns the request
 * already holds, so asking again after a crash yields the same move.
 */
export function referenceModel(plan: Move[]): ModelClient {
  return {
    id: 'reference',
    caps: { ...DEFAULT_CAPS, pricing: { inPerMTok: 1, outPerMTok: 1 } },
    async complete(req) {
      const turns = req.messages.filter((m) => m.role === 'assistant').length;
      const move = plan[Math.min(turns, plan.length - 1)] ?? [];
      const usage = { inTokens: 100, outTokens: 10 };
      return typeof move === 'string' ? { text: move, calls: [], usage } : { calls: move, usage };
    },
  };
}
