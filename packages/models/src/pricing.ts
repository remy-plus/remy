import { type ModelCaps, type Usage, usageCostUsd } from '@remy/core';

export function costUsd(usage: Usage, pricing: ModelCaps['pricing']): number {
  return usageCostUsd(usage, pricing);
}
