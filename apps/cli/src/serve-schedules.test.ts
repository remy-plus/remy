import { afterEach, describe, expect, it } from 'vitest';
import { openSchedules } from './schedule-store.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import { createSchedulesMount } from './serve-schedules.ts';
import { openHooks } from './webhook-store.ts';

let kit: Kit | undefined;
afterEach(async () => {
  await kit?.close();
  kit = undefined;
});

const NOW = new Date('2026-11-08T10:00:00');

async function start() {
  let schedules: ReturnType<typeof openSchedules> | undefined;
  let hooks: ReturnType<typeof openHooks> | undefined;
  kit = await startKit((home) => {
    schedules = openSchedules(home);
    hooks = openHooks(home);
    return [
      createSchedulesMount({
        schedules,
        hooks,
        webhookPort: 7788,
        trust: () => 'steady',
        maxCostUsd: () => 2,
        now: () => NOW,
      }),
    ];
  });
  return {
    kit,
    schedules: schedules as ReturnType<typeof openSchedules>,
    hooks: hooks as ReturnType<typeof openHooks>,
  };
}

describe('schedule routes', () => {
  it('need the bearer token', async () => {
    const { kit } = await start();
    for (const [method, path] of [
      ['GET', '/api/schedules'],
      ['POST', '/api/schedules'],
      ['POST', '/api/schedules/sched_1/enabled'],
      ['POST', '/api/schedules/sched_1/run'],
      ['DELETE', '/api/schedules/sched_1'],
      ['GET', '/api/webhooks'],
      ['POST', '/api/webhooks/x/enabled'],
    ] as const)
      expect((await kit.api(path, { method, token: null })).status).toBe(401);
  });

  it('adds with the CLI parser, lists with next run times, and shapes the screen data', async () => {
    const { kit } = await start();
    const add = await kit.api('/api/schedules', {
      body: { prompt: 'Draft the weekly report', when: 'every day at 9' },
    });
    expect(add.status).toBe(201);
    expect(add.json.id).toMatch(/^sched_/);
    const r = await kit.api('/api/schedules');
    expect(r.status).toBe(200);
    expect(r.json.schedules).toEqual([
      expect.objectContaining({
        id: add.json.id,
        title: 'Draft the weekly report',
        when: 'every day at 9',
        enabled: true,
        next: expect.stringMatching(/^next .*· not run yet$/),
      }),
    ]);
    expect(r.json.timeline).toHaveLength(1);
    expect(r.json.runsOn).toEqual(['this machine']);
    expect(r.json.policy).toEqual({ trust: 'steady', stopAbove: '$2' });
    expect(r.json.away).toBe('No scheduled runs started in the last day.');
  });

  it('refuses a time it cannot read, an empty or long prompt, and extra fields', async () => {
    const { kit, schedules } = await start();
    const bad = await kit.api('/api/schedules', {
      body: { prompt: 'x', when: 'whenever you like' },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('every day at 9');
    const fast = await kit.api('/api/schedules', { body: { prompt: 'x', when: 'every 1 minute' } });
    expect(fast.status).toBe(400);
    expect(
      (await kit.api('/api/schedules', { body: { prompt: '  ', when: 'hourly' } })).status,
    ).toBe(400);
    expect(
      (await kit.api('/api/schedules', { body: { prompt: 'x'.repeat(2001), when: 'hourly' } }))
        .status,
    ).toBe(400);
    expect(
      (await kit.api('/api/schedules', { body: { prompt: 'x', when: 'hourly', command: 'rm' } }))
        .status,
    ).toBe(400);
    expect((await kit.api('/api/schedules', { raw: 'not json' })).status).toBe(400);
    expect(schedules.list()).toEqual([]);
    const longest = await kit.api('/api/schedules', {
      body: { prompt: 'x'.repeat(2000), when: 'hourly' },
    });
    expect(longest.status).toBe(201);
  });

  it('pauses and resumes only the named schedule', async () => {
    const { kit, schedules } = await start();
    const a = schedules.add('hourly', 'A', NOW);
    schedules.add('hourly', 'B', NOW);
    expect(
      (await kit.api(`/api/schedules/${a.id}/enabled`, { body: { enabled: false } })).status,
    ).toBe(200);
    expect(schedules.list().map((s) => [s.prompt, s.paused === true])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    const list = await kit.api('/api/schedules');
    const row = list.json.schedules.find((s: { id: string }) => s.id === a.id);
    expect(row).toMatchObject({ enabled: false });
    expect(row.next).toMatch(/^paused/);
    expect(list.json.timeline.map((t: { title: string }) => t.title)).toEqual(['B']);
    await kit.api(`/api/schedules/${a.id}/enabled`, { body: { enabled: true } });
    expect(schedules.list().every((s) => !s.paused)).toBe(true);
    expect(
      (await kit.api('/api/schedules/sched_nope/enabled', { body: { enabled: true } })).status,
    ).toBe(404);
  });

  it('runs one now as an ordinary task and keeps its next time', async () => {
    const { kit, schedules } = await start();
    const s = schedules.add('every day at 9', 'Check the invoices', NOW);
    const r = await kit.api(`/api/schedules/${s.id}/run`, { method: 'POST' });
    expect(r.status).toBe(201);
    expect(r.json.taskId).toMatch(/^task_/);
    expect((await kit.api(`/api/tasks/${r.json.taskId}`)).json.prompt).toBe('Check the invoices');
    const after = schedules.list()[0];
    expect(after).toMatchObject({ lastTask: r.json.taskId, nextRun: s.nextRun });
    expect(after?.lastRun).toBe(NOW.toISOString());
    expect((await kit.api('/api/schedules/sched_nope/run', { method: 'POST' })).status).toBe(404);
    expect((await kit.api('/api/schedules')).json.away).toBe(
      '1 scheduled run started in the last day.',
    );
  });

  it('deletes only the named schedule', async () => {
    const { kit, schedules } = await start();
    const a = schedules.add('hourly', 'A', NOW);
    const b = schedules.add('hourly', 'B', NOW);
    expect((await kit.api(`/api/schedules/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(schedules.list().map((s) => s.id)).toEqual([b.id]);
    expect((await kit.api(`/api/schedules/${a.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await kit.api('/api/schedules/a%20b', { method: 'DELETE' })).status).toBe(404);
    expect((await kit.api(`/api/schedules/${b.id}`, { method: 'PUT', body: {} })).status).toBe(405);
  });
});

describe('webhook routes', () => {
  it('list hooks without any token or hash, and switch the one webhook switch', async () => {
    const { kit, hooks } = await start();
    hooks.add('new-invoice', 'Check it against the bank export', NOW);
    hooks.setTokenHash('new-invoice', 'a'.repeat(64));
    const r = await kit.api('/api/webhooks');
    expect(r.status).toBe(200);
    expect(r.json.webhooks).toEqual([
      expect.objectContaining({
        id: 'new-invoice',
        url: 'POST http://127.0.0.1:7788/hook/new-invoice',
        enabled: false,
      }),
    ]);
    expect(r.text).not.toContain('a'.repeat(64));
    expect(r.json.webhooks[0].detail).toContain('its own token');
    expect(
      (await kit.api('/api/webhooks/new-invoice/enabled', { body: { enabled: true } })).status,
    ).toBe(200);
    expect(hooks.enabled()).toBe(true);
    const sched = await kit.api('/api/schedules');
    expect(sched.json.webhooks[0].enabled).toBe(true);
    expect(sched.text).not.toContain('a'.repeat(64));
    expect((await kit.api('/api/webhooks/nope/enabled', { body: { enabled: false } })).status).toBe(
      404,
    );
    expect(hooks.enabled()).toBe(true);
  });

  it('says what a hook runs with one full stop, never two', async () => {
    const { kit, hooks } = await start();
    hooks.add(
      'deploys',
      'Check the deploy result and tell me in one line if anything failed.',
      NOW,
    );
    hooks.add('passed', 'Did the deploy pass?', NOW);
    hooks.add('plain', 'Check it', NOW);
    hooks.add('long', 'x'.repeat(100), NOW);
    const details = Object.fromEntries(
      (await kit.api('/api/webhooks')).json.webhooks.map((w: { id: string; detail: string }) => [
        w.id,
        w.detail,
      ]),
    );
    const tail =
      ' Payloads are treated as untrusted, and the run is marked as having read untrusted content. It uses the shared token.';
    expect(details.deploys).toBe(
      `Runs "Check the deploy result and tell me in one line if anything failed."${tail}`,
    );
    expect(details.passed).toBe(`Runs "Did the deploy pass?"${tail}`);
    expect(details.plain).toBe(`Runs "Check it."${tail}`);
    expect(details.long).toBe(`Runs "${'x'.repeat(79)}…"${tail}`);
    expect(Object.values(details).join('\n')).not.toMatch(/[.!?]"\./);
  });

  it('creates a hook, refuses a duplicate and a bad name, and never returns a token', async () => {
    const { kit, hooks } = await start();
    const made = await kit.api('/api/webhooks', {
      body: { name: 'deploys', prompt: ' Check it ' },
    });
    expect(made.status).toBe(201);
    expect(made.json).toEqual(
      expect.objectContaining({
        id: 'deploys',
        name: 'deploys',
        url: 'POST http://127.0.0.1:7788/hook/deploys',
        enabled: false,
      }),
    );
    expect(made.text).not.toMatch(/token ?hash|"token"/i);
    expect(hooks.get('deploys')?.prompt).toBe('Check it');
    const dup = await kit.api('/api/webhooks', { body: { name: 'deploys', prompt: 'x' } });
    expect(dup.status).toBe(409);
    const bad = await kit.api('/api/webhooks', { body: { name: 'Bad Name', prompt: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('1 to 40 characters');
    const none = await kit.api('/api/webhooks', { body: { name: 'blank', prompt: '  ' } });
    expect(none.status).toBe(400);
    expect(none.json.error).toBe('A hook needs a prompt.');
    expect(
      (await kit.api('/api/webhooks', { body: { name: 'a', prompt: 'b', extra: 1 } })).status,
    ).toBe(400);
    hooks.setTokenHash('deploys', 'b'.repeat(64));
    expect((await kit.api('/api/webhooks')).text).not.toContain('b'.repeat(64));
    expect(hooks.list()).toHaveLength(1);
  });

  it('removes a hook, and says 404 for one that is not there', async () => {
    const { kit, hooks } = await start();
    hooks.add('deploys', 'Check it', NOW);
    const gone = await kit.api('/api/webhooks/deploys', { method: 'DELETE' });
    expect(gone.status).toBe(204);
    expect(gone.text).toBe('');
    expect(hooks.list()).toEqual([]);
    expect((await kit.api('/api/webhooks/deploys', { method: 'DELETE' })).status).toBe(404);
  });
});
