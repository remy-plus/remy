import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import { createSkillsMount, stepsOf } from './serve-skills.ts';
import { openSkills } from './skills.ts';
import { fakeNet } from './skills-directory.test-kit.ts';

let kit: Kit | undefined;
afterEach(async () => {
  await kit?.close();
  kit = undefined;
});

const md = (name: string, description: string, body: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}\n`;

async function start(f?: (u: string) => Promise<Response>) {
  let store: ReturnType<typeof openSkills> | undefined;
  kit = await startKit((home) => {
    store = openSkills(home, join(home, 'project'));
    return [createSkillsMount({ skills: store, ...(f && { fetch: f as typeof fetch }) })];
  });
  const put = (dir: string, name: string, text: string) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), text);
  };
  return { kit, store: store as ReturnType<typeof openSkills>, put };
}

describe('skills routes', () => {
  it('needs the bearer token', async () => {
    const { kit } = await start();
    for (const [method, path] of [
      ['GET', '/api/skills'],
      ['GET', '/api/skills/any'],
      ['POST', '/api/skills/any/enabled'],
      ['POST', '/api/skills/any/run'],
    ] as const)
      expect((await kit.api(path, { method, token: null })).status).toBe(401);
  });

  it('lists the built-ins and yours, with steps, source and no suggestion', async () => {
    const { kit, put } = await start();
    put(
      join(kit.home, 'skills'),
      'rename-receipts',
      md(
        'rename-receipts',
        'Rename receipts by date and vendor',
        '1. Open the folder.\n2. Rename each file.\n- Check the totals',
      ),
    );
    put(
      join(kit.home, 'skills'),
      'dana-first',
      md('dana-first', 'Send questions to Dana first', '1. Ask Dana.', 'learned: true\n'),
    );
    put(
      join(kit.home, 'project', '.remy', 'skills'),
      'deploy',
      md('deploy', 'Ship the site', '1. Run the deploy.'),
    );
    const r = await kit.api('/api/skills');
    expect(r.status).toBe(200);
    expect(r.json.suggestion).toBeNull();
    const by = Object.fromEntries(r.json.skills.map((s: { name: string }) => [s.name, s]));
    expect(by['rename-receipts']).toMatchObject({
      blurb: 'Rename receipts by date and vendor',
      source: 'yours',
      enabled: true,
      used: 0,
      lastRun: null,
      origin: null,
      steps: [
        { title: 'Open the folder.', detail: '' },
        { title: 'Rename each file.', detail: '' },
        { title: 'Check the totals', detail: '' },
      ],
    });
    expect(by['dana-first']).toMatchObject({
      source: 'learned',
      origin: 'Saved from a correction you made.',
    });
    expect(by.deploy.origin).toContain('Not reviewed');
    expect(r.json.skills.some((s: { source: string }) => s.source === 'builtin')).toBe(true);
    expect(r.text).not.toContain(kit.home); // no local paths
  });

  it('shows one skill with its text, and 404s an unknown or odd name', async () => {
    const { kit, put } = await start();
    put(join(kit.home, 'skills'), 'one', md('one', 'First', '1. Do it.'));
    const r = await kit.api('/api/skills/one');
    expect(r.json).toMatchObject({ name: 'one', body: '1. Do it.', tools: [] });
    expect((await kit.api('/api/skills/nope')).status).toBe(404);
    expect((await kit.api('/api/skills/a%20b')).status).toBe(404);
  });

  it('switches a skill off for Remy and back on, without deleting it', async () => {
    const { kit, store, put } = await start();
    put(join(kit.home, 'skills'), 'one', md('one', 'First', '1. Do it.'));
    expect((await kit.api('/api/skills/one/enabled', { body: { enabled: false } })).status).toBe(
      200,
    );
    expect(store.list().some((s) => s.name === 'one')).toBe(false); // Remy no longer sees it
    expect(store.all().some((s) => s.name === 'one')).toBe(true);
    const list = await kit.api('/api/skills');
    expect(list.json.skills.find((s: { name: string }) => s.name === 'one').enabled).toBe(false);
    await kit.api('/api/skills/one/enabled', { body: { enabled: true } });
    expect(store.list().some((s) => s.name === 'one')).toBe(true);
  });

  it('refuses a bad body, an extra field and an unknown skill', async () => {
    const { kit, put } = await start();
    put(join(kit.home, 'skills'), 'one', md('one', 'First', '1. Do it.'));
    expect((await kit.api('/api/skills/one/enabled', { body: { enabled: 'yes' } })).status).toBe(
      400,
    );
    expect(
      (await kit.api('/api/skills/one/enabled', { body: { enabled: true, name: 'x' } })).status,
    ).toBe(400);
    expect((await kit.api('/api/skills/nope/enabled', { body: { enabled: true } })).status).toBe(
      404,
    );
    expect((await kit.api('/api/skills/one', { method: 'DELETE' })).status).toBe(405);
  });

  it('runs a skill as an ordinary task, and refuses one that is switched off', async () => {
    const { kit, put } = await start();
    put(join(kit.home, 'skills'), 'one', md('one', 'First', '1. Do it.'));
    const run = await kit.api('/api/skills/one/run', { method: 'POST' });
    expect(run.status).toBe(201);
    expect(run.json.taskId).toMatch(/^task_/);
    const task = await kit.api(`/api/tasks/${run.json.taskId}`);
    expect(task.json.prompt).toBe('Use the one skill.');
    await kit.api('/api/skills/one/enabled', { body: { enabled: false } });
    const off = await kit.api('/api/skills/one/run', { method: 'POST' });
    expect(off.status).toBe(409);
    expect((await kit.api('/api/skills/nope/run', { method: 'POST' })).status).toBe(404);
  });
});

describe('stepsOf', () => {
  it('takes numbered and bulleted lines only, clipped', () => {
    expect(stepsOf('Intro\n1) First\n  - Second\nnot a step\n* Third')).toEqual([
      { title: 'First', detail: '' },
      { title: 'Second', detail: '' },
      { title: 'Third', detail: '' },
    ]);
    expect(stepsOf(`1. ${'x'.repeat(500)}`)[0]?.title).toHaveLength(160);
  });
});

describe('skills directory routes', () => {
  it('needs the bearer token', async () => {
    const { kit } = await start(fakeNet().f);
    expect((await kit.api('/api/skills/directory?q=pdf', { token: null })).status).toBe(401);
    expect(
      (await kit.api('/api/skills/directory/install', { method: 'POST', token: null, body: {} }))
        .status,
    ).toBe(401);
  });

  it('searches both directories with a note, and caches for 60 seconds', async () => {
    const net = fakeNet();
    const { kit } = await start(net.f);
    const a = await kit.api('/api/skills/directory?q=pdf&from=skills');
    expect(a.status).toBe(200);
    expect(a.json.results[0]).toMatchObject({
      id: 'anthropics/skills/pdf',
      detail: '227,931 installs',
    });
    expect(a.json.note).toContain('text only');
    await kit.api('/api/skills/directory?q=PDF');
    expect(net.seen.filter((u) => u.includes('skills.sh/api/search'))).toHaveLength(1);
    const b = await kit.api('/api/skills/directory?q=call&from=bots');
    expect(b.json.results[0]).toMatchObject({ source: 'botdirectory', id: 'call-cost-saver' });
    expect((await kit.api('/api/skills/directory?q=')).status).toBe(400);
    expect((await kit.api('/api/skills/directory?q=x&from=nope')).status).toBe(400);
  });

  it('answers 502 with a sentence when the directory is down', async () => {
    const { kit } = await start(async () => {
      throw new Error('offline');
    });
    const r = await kit.api('/api/skills/directory?q=pdf');
    expect(r.status).toBe(502);
    expect(r.json.error ?? r.text).toContain('skills.sh could not be reached');
  });

  it('installs from each directory (201), then 409, 404 and 400', async () => {
    const { kit, store } = await start(fakeNet().f);
    const post = (body: unknown) =>
      kit.api('/api/skills/directory/install', { method: 'POST', body });
    const a = await post({ source: 'skills.sh', id: 'anthropics/skills/pdf' });
    expect(a.status).toBe(201);
    expect(a.json.skill).toMatchObject({ name: 'pdf', source: 'yours', enabled: true });
    expect(a.json.skill.origin).toContain('From a link');
    expect(store.web('pdf')?.origin.commit).toBeDefined();
    expect((await post({ source: 'skills.sh', id: 'anthropics/skills/pdf' })).status).toBe(409);
    const b = await post({ source: 'botdirectory', id: 'call-cost-saver' });
    expect(b.status).toBe(201);
    expect(b.json.skill.name).toBe('call-cost-saver');
    expect((await post({ source: 'botdirectory', id: 'missing-bot' })).status).toBe(404);
    expect((await post({ source: 'skills.sh', id: 'bad' })).status).toBe(400);
    expect((await post({ source: 'other', id: 'x' })).status).toBe(400);
    expect((await post({ source: 'skills.sh', id: 'a/b/c', extra: 1 })).status).toBe(400);
  });
});
