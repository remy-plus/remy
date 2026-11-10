import { type Browser, fixtureBrowser } from '@remy/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserMount, FRAME_MIN_INTERVAL_MS } from './serve-browser.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';

const WEB = { 'https://shop.test/cart': '<title>Cart</title><p>Two loaves</p>' };
const kits: Kit[] = [];
afterEach(async () => {
  for (const k of kits.splice(0)) await k.close();
});

async function start(browser: Browser | undefined) {
  const clock = { t: 1000 };
  const screenshots = { n: 0 };
  const counted: Browser | undefined = browser && {
    ...browser,
    screenshot: () => {
      screenshots.n++;
      return browser.screenshot();
    },
  };
  const kit = await startKit(() => [
    createBrowserMount({
      browser: () => counted,
      redact: (t) => t.replace(/token=[^&]+/g, 'token=[redacted]'),
      now: () => clock.t,
    }),
  ]);
  kits.push(kit);
  const frame = (token: string | null = kit.token) =>
    fetch(`${kit.base}/api/browser/frame`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return { kit, clock, screenshots, frame };
}

describe('browser routes', () => {
  it('needs the bearer token', async () => {
    const { kit, frame } = await start(fixtureBrowser(WEB));
    expect((await kit.api('/api/browser/state', { token: null })).status).toBe(401);
    expect((await frame(null)).status).toBe(401);
  });

  it('says closed when there is no browser or no page', async () => {
    for (const b of [undefined, fixtureBrowser(WEB)]) {
      const { kit, frame } = await start(b);
      const s = await kit.api('/api/browser/state');
      expect(s.status).toBe(200);
      expect(s.json).toEqual({ open: false });
      expect((await frame()).status).toBe(204);
    }
  });

  it('shows the page that is open, with secrets in the address redacted', async () => {
    const b = fixtureBrowser({
      ...WEB,
      'https://shop.test/pay?token=abc123': '<title>Pay</title>',
    });
    const { kit, frame } = await start(b);
    await b.open('https://shop.test/cart');
    expect((await kit.api('/api/browser/state')).json).toEqual({
      open: true,
      url: 'https://shop.test/cart',
      title: 'Cart',
    });
    await b.open('https://shop.test/pay?token=abc123');
    const s = (await kit.api('/api/browser/state')).json;
    expect(s.url).toBe('https://shop.test/pay?token=[redacted]');
    const f = await frame();
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toBe('image/jpeg');
    expect(f.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await f.arrayBuffer()).toString()).toContain('fixture-frame:');
    expect(b.presses).toEqual([]);
  });

  it('serves at most four frames a second, the cached one in between', async () => {
    const b = fixtureBrowser(WEB);
    const { frame, clock, screenshots } = await start(b);
    await b.open('https://shop.test/cart');
    await (await frame()).arrayBuffer();
    clock.t += FRAME_MIN_INTERVAL_MS - 1;
    const again = await frame();
    expect(again.status).toBe(200);
    await again.arrayBuffer();
    expect(screenshots.n).toBe(1);
    clock.t += 1;
    await (await frame()).arrayBuffer();
    expect(screenshots.n).toBe(2);
  });

  it('only answers GET', async () => {
    const { kit } = await start(fixtureBrowser(WEB));
    expect((await kit.api('/api/browser/state', { method: 'POST', body: {} })).status).toBe(405);
  });
});
