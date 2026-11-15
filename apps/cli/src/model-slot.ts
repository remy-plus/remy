// The model `remy serve` uses, in a slot that can be filled or replaced while the server runs, so a
// person with no key can add one in the browser and carry on without restarting. The client handed
// to the runtime is a thin proxy: it reads `id`, `caps` and `complete` from whatever is in the slot
// at that moment. An empty slot answers like a model that cannot be reached, so a task that was
// resumed before a key exists pauses and keeps its place instead of failing.
import { type ModelClient, ModelError } from '@remy/core';
import { DEFAULT_CAPS } from '@remy/models';

/** Thrown when no provider, model or key is set up. `remy serve` starts anyway and asks in the browser. */
export class NoModelError extends Error {
  override name = 'NoModelError';
}

export const EMPTY_SLOT_MESSAGE = 'No model is set up yet. Add a key to carry on.';

export interface ModelSlot {
  /** Pass this to the runtime. It follows the slot. */
  readonly client: ModelClient;
  /** True once a model is in the slot. */
  ready(): boolean;
  /** Puts a model in the slot (replacing any). Later calls use it at once. */
  set(model: ModelClient): void;
}

export function createModelSlot(initial?: ModelClient): ModelSlot {
  let current: ModelClient | undefined = initial;
  const client: ModelClient = {
    get id() {
      return current?.id ?? 'none';
    },
    get caps() {
      return current?.caps ?? DEFAULT_CAPS;
    },
    complete(...args) {
      if (!current)
        return Promise.reject(new ModelError(EMPTY_SLOT_MESSAGE, false, { unreachable: true }));
      // Every argument, so later ones (the streamed finish answer) are never dropped.
      return current.complete(...args);
    },
  };
  return {
    client,
    ready: () => current !== undefined,
    set(model) {
      current = model;
    },
  };
}
