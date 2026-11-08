import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonWebhooks, shouldListen } from './webhook-service.ts';
import { openHooks } from './webhook-store.ts';
import { sharedToken } from './webhook-token.ts';

const home = () => mkdtempSync(join(tmpdir(), 'remy-whsvc-'));
const now = new Date();
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const opts = (h: string, env: Record<string, string> = {}) => ({
  home: h,
  env: { REMY_WEBHOOK_PORT: '0', ...env },
  start: async () => 'task_abc123',
  isActive: async () => false,
  log: () => {},
});

describe('daemon wiring', () => {
  it('does not listen by default, with a hook but not enabled, or enabled with no hook', async () => {
    const h = home();
    expect(shouldListen(h)).toBe(false);
    openHooks(h).add('a', 'p', now);
    expect(await daemonWebhooks(opts(h))).toBeUndefined();
    const h2 = home();
    openHooks(h2).setEnabled(true);
    expect(await daemonWebhooks(opts(h2))).toBeUndefined();
  });

  it('listens on loopback when enabled with a hook, and answers a call', async () => {
    const h = home();
    const hooks = openHooks(h);
    hooks.add('a', 'p', now);
    hooks.setEnabled(true);
    const l = await daemonWebhooks(opts(h));
    expect(l).toBeDefined();
    close = l?.close;
    expect(l?.host).toBe('127.0.0.1');
    const r = await fetch(`http://127.0.0.1:${l?.port}/hook/a`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sharedToken(h)}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ run: 'task_abc123' });
  });

  it('a refused address is logged and does not stop the daemon', async () => {
    const h = home();
    const hooks = openHooks(h);
    hooks.add('a', 'p', now);
    hooks.setEnabled(true);
    const lines: string[] = [];
    const l = await daemonWebhooks({ ...opts(h), bind: '0.0.0.0', log: (x) => lines.push(x) });
    expect(l).toBeUndefined();
    expect(lines.join()).toContain('Webhooks did not start');
  });
});
