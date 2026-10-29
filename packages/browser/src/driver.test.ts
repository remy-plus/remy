import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalBrowser } from './driver.ts';
import type { Browser } from './port.ts';

const PAGES: Record<string, string> = {
  '/': `<!doctype html><title>Shop</title>
    <h1>Welcome</h1><p>Fresh bread every morning.</p>
    <a href="/about">About us</a>
    <a href="/promo" target="_blank">Promo</a>
    <form action="/search" method="get"><input name="q" aria-label="Search"></form>
    <form action="/buy" method="post">
      <input name="email" placeholder="Email">
      <input type="password" name="pw" aria-label="Password">
      <input name="cardnumber" autocomplete="cc-number" aria-label="Card">
      <button>Buy now</button>
    </form>
    <button style="display:none">Hidden</button>`,
  '/about': '<!doctype html><title>About</title><p>Since 1990.</p>',
  '/promo': '<!doctype html><title>Promo</title><p>Half price.</p>',
};

let server: Server;
let base: string;
let browser: Browser;
let profile: string;
let available = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const body =
      url.pathname === '/search'
        ? `<!doctype html><title>Results</title><p>You searched ${url.searchParams.get('q')}</p>`
        : PAGES[url.pathname];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ?? 'missing');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  profile = mkdtempSync(join(tmpdir(), 'remy-browser-test-'));
  browser = createLocalBrowser({ profileDir: profile, allowLocal: true });
  try {
    await browser.open(`${base}/`);
  } catch (e) {
    if (!/no browser/i.test(String(e))) throw e;
    available = false; // no Chrome, Edge or Chromium on this machine
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  rmSync(profile, { recursive: true, force: true });
});

describe.runIf(process.env.REMY_SKIP_BROWSER !== '1')('local browser', () => {
  it('snapshots text and numbered controls with their kinds', async ({ skip }) => {
    if (!available) skip();
    const s = await browser.open(`${base}/`);
    expect(s.title).toBe('Shop');
    expect(s.text).toContain('Fresh bread every morning.');
    const byName = Object.fromEntries(s.elements.map((e) => [e.name, e]));
    expect(byName['About us']).toMatchObject({ kind: 'link', href: `${base}/about` });
    expect(byName.Search).toMatchObject({ kind: 'textbox', formMethod: 'get' });
    expect(byName.Password).toMatchObject({ kind: 'password', formMethod: 'post' });
    expect(byName.Card).toMatchObject({ kind: 'card' });
    expect(byName['Buy now']).toMatchObject({ kind: 'submit', formMethod: 'post' });
    expect(byName.Hidden).toBeUndefined();
    expect(browser.current()).toBe(s);
  });

  it('clicks a link and follows a new tab', async ({ skip }) => {
    if (!available) skip();
    let s = await browser.open(`${base}/`);
    const about = s.elements.find((e) => e.name === 'About us');
    s = await browser.click(about?.ref ?? 0);
    expect(s.title).toBe('About');
    s = await browser.open(`${base}/`);
    s = await browser.click(s.elements.find((e) => e.name === 'Promo')?.ref ?? 0);
    expect(s.title).toBe('Promo');
  });

  it('types into a search box and submits it', async ({ skip }) => {
    if (!available) skip();
    const s = await browser.open(`${base}/`);
    const box = s.elements.find((e) => e.name === 'Search');
    const after = await browser.type(box?.ref ?? 0, 'rye', true);
    expect(after.text).toContain('You searched rye');
  });

  it('says so when a ref is stale', async ({ skip }) => {
    if (!available) skip();
    await browser.open(`${base}/about`);
    await expect(browser.click(99)).rejects.toThrow(/no element \[99\]/);
  });

  it('refuses local addresses unless allowed', async ({ skip }) => {
    if (!available) skip();
    const strict = createLocalBrowser({ profileDir: join(profile, 'strict') });
    try {
      await expect(strict.open(`${base}/`)).rejects.toThrow(/local network/);
    } finally {
      await strict.close();
    }
  });

  it('gives a second process on a locked profile its own profile', async ({ skip }) => {
    if (!available) skip();
    // The lock names this process, so a same-process second browser reuses the profile; fake another pid.
    const { writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'remy-locked-'));
    writeFileSync(join(dir, '.remy-lock'), String(process.ppid));
    const other = createLocalBrowser({ profileDir: dir, allowLocal: true });
    try {
      const s = await other.open(`${base}/about`);
      expect(s.title).toBe('About');
    } finally {
      await other.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
