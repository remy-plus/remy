import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchAgentPlist, tick } from './daemon.ts';
import { openSchedules } from './schedule-store.ts';

const open = () => openSchedules(mkdtempSync(join(tmpdir(), 'remy-daemon-')));
const start = new Date('2026-11-04T08:00:00');
const nine = new Date('2026-11-04T09:00:01');

describe('tick', () => {
  it('starts what is due and sets the next run', async () => {
    const store = open();
    store.add('every day at 9', 'Check the news', start);
    const ran: string[] = [];
    await tick(store, nine, async (p) => {
      ran.push(p);
      return 'task_1';
    });
    expect(ran).toEqual(['Check the news']);
    const [s] = store.list();
    expect(new Date(s?.nextRun as string).getDate()).toBe(5);
    expect(s?.lastTask).toBe('task_1');
  });

  it('does nothing when nothing is due', async () => {
    const store = open();
    store.add('every day at 9', 'p', start);
    const ran: string[] = [];
    await tick(store, start, async (p) => {
      ran.push(p);
      return 'task_1';
    });
    expect(ran).toEqual([]);
  });

  it('runs a missed schedule once, not once per missed day', async () => {
    const store = open();
    store.add('every day at 9', 'p', start);
    const ran: string[] = [];
    const later = new Date('2026-11-09T12:00:00');
    const run = async (p: string) => {
      ran.push(p);
      return 'task_1';
    };
    await tick(store, later, run);
    await tick(store, later, run);
    expect(ran).toHaveLength(1);
  });

  it('never runs twice when starting fails halfway', async () => {
    const store = open();
    store.add('every day at 9', 'p', start);
    let calls = 0;
    await tick(store, nine, async () => {
      calls++;
      throw new Error('no');
    }).catch(() => {});
    await tick(store, nine, async () => {
      calls++;
      return 'task_1';
    });
    expect(calls).toBe(1);
  });

  it('carries on past a schedule that fails to start', async () => {
    const store = open();
    store.add('every day at 9', 'bad', start);
    store.add('every day at 9', 'good', start);
    const ran: string[] = [];
    await tick(store, nine, async (p) => {
      if (p === 'bad') throw new Error('no');
      ran.push(p);
      return 'task_1';
    });
    expect(ran).toEqual(['good']);
  });
});

describe('a watch', () => {
  const setup = () => {
    const store = open();
    const s = store.add('when ~/Downloads changes', 'Sort the new files', start);
    store.update({ ...s, nextRun: start.toISOString() });
    return store;
  };
  const due = (store: ReturnType<typeof open>) => {
    const [s] = store.list();
    if (s) store.update({ ...s, nextRun: start.toISOString() });
  };

  it('notes the time on the first look and runs nothing', async () => {
    const store = setup();
    const ran: string[] = [];
    await tick(
      store,
      nine,
      async (p) => {
        ran.push(p);
        return 'task_1';
      },
      undefined,
      () => 100,
    );
    expect(ran).toEqual([]);
    expect(store.list()[0]?.seenChange).toBe(100);
  });

  it('runs once when the file changes', async () => {
    const store = setup();
    const ran: string[] = [];
    const run = async (p: string) => {
      ran.push(p);
      return 'task_1';
    };
    await tick(store, nine, run, undefined, () => 100);
    due(store);
    await tick(store, nine, run, undefined, () => 200);
    due(store);
    await tick(store, nine, run, undefined, () => 200);
    expect(ran).toHaveLength(1);
  });

  it('waits quietly while the path is missing', async () => {
    const store = setup();
    const ran: string[] = [];
    await tick(
      store,
      nine,
      async (p) => {
        ran.push(p);
        return 'task_1';
      },
      undefined,
      () => undefined,
    );
    expect(ran).toEqual([]);
  });
});

describe('launchAgentPlist', () => {
  const plist = launchAgentPlist(
    { execPath: '/usr/bin/node', execArgv: [], script: '/x/remy.js' },
    '/h/daemon.log',
    '/opt/bin',
  );

  it('starts at login and keeps running', () => {
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
  });

  it('runs the daemon with this install', () => {
    expect(plist).toContain('<string>/usr/bin/node</string>');
    expect(plist).toContain('<string>/x/remy.js</string>');
    expect(plist).toContain('<string>daemon</string>');
  });

  it('passes on PATH, since launchd sets almost none', () => {
    expect(plist).toContain('<string>/opt/bin</string>');
  });

  it('escapes paths', () => {
    expect(launchAgentPlist({ execPath: 'a&b', execArgv: [], script: '' }, 'l')).toContain(
      'a&amp;b',
    );
  });
});
