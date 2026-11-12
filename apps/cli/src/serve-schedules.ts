// `remy serve` routes for schedules and webhooks: what the web app's Schedules screens call.
//
//   GET    /api/schedules                list, with next run times, an upcoming timeline and hooks
//   POST   /api/schedules                {prompt, when}  add one (same parser and limits as the CLI)
//   POST   /api/schedules/:id/enabled    {enabled}       pause or resume
//   POST   /api/schedules/:id/run        start its task now -> { taskId }
//   DELETE /api/schedules/:id            remove only that schedule
//   GET    /api/webhooks                 hooks by name and address; never a token or a token hash
//   POST   /api/webhooks                 {name, prompt}  add one (HookStore.add checks it, as the CLI does) -> 201
//   DELETE /api/webhooks/:name           remove it -> 204
//   POST   /api/webhooks/:name/enabled   {enabled}
//
// A schedule grants nothing: each run is an ordinary background task with ordinary approvals.
// Webhooks have one switch for all hooks (the CLI's `remy webhook enable`), so the per-hook switch
// in the screen sets that one switch, and the note on the list says so.
import { z } from 'zod';
import type { Schedule } from './schedule.ts';
import type { ScheduleStore } from './schedule-store.ts';
import {
  guard,
  HttpFail,
  idOf,
  jsonBody,
  type Mount,
  methodNotAllowed,
  ok,
} from './serve-mount.ts';
import type { Hook, HookStore } from './webhook-store.ts';

export const SCHEDULE_PROMPT_MAX = 2000;
const WHEN_MAX = 200;
const SCHEDULES_MAX = 100;
const TIMELINE_MAX = 5;

export interface SchedulesMountDeps {
  schedules: ScheduleStore;
  hooks: HookStore;
  /** The port `remy webhook start` listens on, for the address shown. */
  webhookPort: number;
  trust(): 'ask' | 'steady' | 'away';
  /** The most one task may cost before it stops and asks. */
  maxCostUsd(): number;
  now?: () => Date;
}

const createBody = z
  .object({
    prompt: z.string().trim().min(1).max(SCHEDULE_PROMPT_MAX),
    when: z.string().trim().min(1).max(WHEN_MAX),
  })
  .strict();
const hookBody = z.object({ name: z.string().trim().min(1).max(100), prompt: z.string() }).strict();
const enabledBody = z.object({ enabled: z.boolean() }).strict();

const clip = (t: string, max: number) => {
  const line = t.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** A clipped prompt quoted in a sentence: a prompt that already ends with . ! ? or … gets no full stop. */
const sentence = (t: string, max: number) => {
  const line = clip(t, max);
  return !line || /[.!?…]$/.test(line) ? line : `${line}.`;
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function createSchedulesMount(deps: SchedulesMountDeps): Mount {
  const { schedules, hooks } = deps;
  const now = deps.now ?? (() => new Date());

  const item = (s: Schedule) => {
    const watching = /^when .+ changes$/i.test(s.when.trim());
    const last = s.lastRun ? `last ran ${stamp(s.lastRun)}` : 'not run yet';
    return {
      id: s.id,
      title: clip(s.prompt, 60),
      detail:
        s.prompt.length > 60
          ? clip(s.prompt, 160)
          : 'Runs as a background task. Anything that changes something still asks you.',
      when: s.when,
      next: s.paused
        ? `paused · ${last}`
        : `${watching ? 'checks every 5 minutes' : `next ${stamp(s.nextRun)}`} · ${last}`,
      enabled: s.paused !== true,
    };
  };

  const hookItem = (h: Hook) => ({
    id: h.name,
    name: h.name,
    url: `POST http://127.0.0.1:${deps.webhookPort}/hook/${h.name}`,
    detail: `Runs "${sentence(h.prompt, 80)}" Payloads are treated as untrusted, and the run is marked as having read untrusted content. ${h.tokenHash ? 'It has its own token.' : 'It uses the shared token.'}`,
    enabled: hooks.enabled(),
  });
  const webhooks = () => hooks.list().map(hookItem);
  const webhooksNote = () =>
    hooks.enabled()
      ? 'Webhooks are on, for every hook together.'
      : 'Webhooks are off, for every hook together.';

  function list() {
    const all = schedules.list();
    const t = now().getTime();
    const upcoming = all
      .filter((s) => !s.paused)
      .sort((a, b) => (a.nextRun < b.nextRun ? -1 : a.nextRun > b.nextRun ? 1 : 0))
      .slice(0, TIMELINE_MAX)
      .map((s) => ({
        at: stamp(s.nextRun),
        title: clip(s.prompt, 60),
        soon: new Date(s.nextRun).getTime() - t < 3_600_000,
      }));
    const recent = all.filter((s) => s.lastRun && t - new Date(s.lastRun).getTime() < 86_400_000);
    return {
      schedules: all.map(item),
      timeline: upcoming,
      webhooks: webhooks(),
      webhooksNote: webhooksNote(),
      away: recent.length
        ? `${recent.length} scheduled ${recent.length === 1 ? 'run' : 'runs'} started in the last day.`
        : 'No scheduled runs started in the last day.',
      runsOn: ['this machine'],
      policy: {
        trust: deps.trust(),
        stopAbove: `$${deps.maxCostUsd()}`,
      },
    };
  }

  const need = (id: string) => {
    const s = schedules.list().find((x) => x.id === id);
    if (!s) throw new HttpFail(404, 'There is no such schedule.');
    return s;
  };

  return guard(async ({ req, method, parts, startTask }) => {
    const [head, id, action] = parts;
    if (head === 'webhooks') {
      if (parts.length === 1) {
        if (method === 'GET') return ok({ webhooks: webhooks(), note: webhooksNote() });
        if (method !== 'POST') return methodNotAllowed('GET', 'POST');
        const b = await jsonBody(req, hookBody);
        try {
          return ok(hookItem(hooks.add(b.name, b.prompt, now())), 201);
        } catch (e) {
          // The store's own sentence says what is wrong; a clash is the only 409.
          const text = e instanceof Error ? e.message : 'That webhook was not saved.';
          throw new HttpFail(text.startsWith('There is already') ? 409 : 400, text);
        }
      }
      if (parts.length === 2) {
        if (method !== 'DELETE') return methodNotAllowed('DELETE');
        if (!hooks.remove(idOf(id))) throw new HttpFail(404, 'There is no such webhook.');
        return { status: 204 };
      }
      if (parts.length === 3 && action === 'enabled') {
        if (method !== 'POST') return methodNotAllowed('POST');
        const name = idOf(id);
        const b = await jsonBody(req, enabledBody);
        if (!hooks.get(name)) throw new HttpFail(404, 'There is no such webhook.');
        hooks.setEnabled(b.enabled);
        return ok();
      }
      return undefined;
    }
    if (head !== 'schedules' || parts.length > 3) return undefined;
    if (parts.length === 1) {
      if (method === 'GET') return ok(list());
      if (method !== 'POST') return methodNotAllowed('GET', 'POST');
      const b = await jsonBody(req, createBody);
      if (schedules.list().length >= SCHEDULES_MAX)
        throw new HttpFail(400, `Remy keeps at most ${SCHEDULES_MAX} schedules. Remove one first.`);
      try {
        const s = schedules.add(b.when, b.prompt, now());
        return ok({ id: s.id, next: stamp(s.nextRun) }, 201);
      } catch (e) {
        // The parser's own message says how to write the time; it holds nothing private.
        throw new HttpFail(400, e instanceof Error ? e.message : 'That time was not understood.');
      }
    }
    const sid = idOf(id);
    if (parts.length === 2) {
      if (method !== 'DELETE') return methodNotAllowed('DELETE');
      if (!schedules.remove(sid)) throw new HttpFail(404, 'There is no such schedule.');
      return ok();
    }
    if (action === 'enabled') {
      if (method !== 'POST') return methodNotAllowed('POST');
      const b = await jsonBody(req, enabledBody);
      if (!schedules.setPaused(sid, !b.enabled))
        throw new HttpFail(404, 'There is no such schedule.');
      return ok();
    }
    if (action === 'run') {
      if (method !== 'POST') return methodNotAllowed('POST');
      await jsonBody(req, z.object({}).strict(), true);
      const s = need(sid);
      const started = await startTask(s.prompt);
      // Only the record of the run changes; the next scheduled time stays as it was.
      schedules.update({ ...s, lastRun: now().toISOString(), lastTask: started.taskId });
      return ok(started, 201);
    }
    return undefined;
  });
}
