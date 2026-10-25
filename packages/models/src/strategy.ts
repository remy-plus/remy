import type { ModelClient } from '@remy/core';
import { withJsonTools } from './json-tools.ts';
import { withNativeTools } from './native.ts';

export function selectStrategy(raw: ModelClient): ModelClient {
  return raw.caps.nativeTools ? withNativeTools(raw) : withJsonTools(raw);
}
