import type { ModelCaps, Usage } from '@remy/core';

export function costUsd(usage: Usage, pricing: ModelCaps['pricing']): number {
  return (usage.inTokens * pricing.inPerMTok + usage.outTokens * pricing.outPerMTok) / 1_000_000;
}
