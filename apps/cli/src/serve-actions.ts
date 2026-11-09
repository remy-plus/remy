// The settings screen's actions: delete every note, make a new access token, test the model and
// send a test notification. Each needs the bearer token like every route. The new token is in the
// answer to /api/token/rotate and nowhere else: only its hash is kept, and the old one stops
// working on the next request.
import { type EventStore, fold, isHelperTask, type ModelClient } from '@remy/core';
import { z } from 'zod';
import type { ApiRoute } from './serve.ts';
import { HttpError } from './serve.ts';
import type { WebPrefsStore } from './serve-settings.ts';
import type { Redact } from './serve-view.ts';

export interface ActionDeps {
  store: EventStore;
  prefs: WebPrefsStore;
  redact?: Redact;
  notes: { count(): number; clear(): number };
  /** Makes a new token, keeps its hash and returns it. */
  rotateToken(): string;
  model: ModelClient;
}

const confirmBody = z.object({ confirm: z.number().int().min(0).max(1e9) }).strict();
const TEST_TIMEOUT_MS = 20_000;

/** True when a running task has spent more than `cap` USD. */
export async function overCap(store: EventStore, cap: number): Promise<boolean> {
  for (const s of await store.listTasks({ status: 'running' })) {
    if (isHelperTask(s.taskId)) continue;
    if (fold(await store.read(s.taskId)).costUsd > cap) return true;
  }
  return false;
}

export function actionRoutes(d: ActionDeps): ApiRoute {
  const redact: Redact = d.redact ?? ((t) => t);
  const none = z.object({}).strict();
  return async (ctx) => {
    const [a, b] = ctx.parts;
    if (ctx.parts.length !== 2) return undefined;
    const post = { status: 405, headers: { allow: 'POST' } };

    if (a === 'notes' && b === 'delete-all') {
      if (ctx.method !== 'POST') return post;
      const { confirm } = await ctx.body(confirmBody);
      const count = d.notes.count();
      // The screen names the count; a different number means the notes changed since it was drawn.
      if (confirm !== count)
        throw new HttpError(409, `There are ${count} notes, not ${confirm}. Nothing was deleted.`);
      return { status: 200, body: { deleted: d.notes.clear() } };
    }

    if (a === 'token' && b === 'rotate') {
      if (ctx.method !== 'POST') return post;
      await ctx.body(none, true);
      return { status: 200, body: { token: d.rotateToken() } };
    }

    if (a === 'models' && b === 'test') {
      if (ctx.method !== 'POST') return post;
      await ctx.body(none, true);
      const cap = d.prefs.get().budget.perTask;
      if (await overCap(d.store, cap))
        throw new HttpError(
          409,
          'A task has spent more than your per-task stop. The test waits until it ends.',
        );
      try {
        await d.model.complete(
          {
            system: 'Answer with one word.',
            messages: [{ role: 'user', content: 'ok?' }],
            tools: [],
            maxOutputTokens: 1,
            temperature: 0,
          },
          AbortSignal.timeout(TEST_TIMEOUT_MS),
        );
      } catch (e) {
        const why = redact(e instanceof Error ? e.message : 'no answer')
          .replace(/\s+/g, ' ')
          .slice(0, 160);
        return { status: 200, body: { ok: false, detail: `${d.model.id} did not answer: ${why}` } };
      }
      return {
        status: 200,
        body: {
          ok: true,
          detail: `${d.model.id} answered. The test sent one word and asked for one back, which costs a fraction of a cent (nothing on a local model).`,
        },
      };
    }

    if (a === 'notifications' && b === 'test') {
      if (ctx.method !== 'POST') return post;
      await ctx.body(none, true);
      // Real push delivery (to a phone or the browser when it is closed) is not built yet, so
      // nothing leaves this machine. The answer says so rather than pretending.
      return {
        status: 200,
        body: {
          ok: true,
          detail: 'Noted. Remy does not send push messages yet, so nothing was sent.',
        },
      };
    }
    return undefined;
  };
}
