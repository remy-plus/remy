import type { Tool, ToolContext, ToolResult } from '@remy/core';
import { describe, expect, it } from 'vitest';
import type { Browser, PageElement, PageSnapshot } from './port.ts';
import { createBrowserTools, renderSnapshot } from './tools.ts';

const el = (
  ref: number,
  kind: PageElement['kind'],
  name: string,
  extra: Partial<PageElement> = {},
) => ({ ref, kind, role: kind === 'link' ? 'a' : 'button', name, ...extra }) as PageElement;

const SHOP: PageSnapshot = {
  url: 'https://shop.test/cart',
  title: 'Cart',
  text: 'Your cart: rye bread.',
  elements: [
    el(1, 'link', 'Home', { href: 'https://shop.test/' }),
    el(2, 'textbox', 'Search', { role: 'searchbox', form: 0, formMethod: 'get' }),
    el(3, 'textbox', 'Email', { role: 'input', form: 1, formMethod: 'post', value: 'a@b.test' }),
    el(4, 'password', 'Password', { form: 1, formMethod: 'post' }),
    el(5, 'submit', 'Sign up', { form: 1, formMethod: 'post' }),
    el(6, 'button', 'Buy now'),
    el(7, 'button', 'Show details'),
    el(8, 'textbox', 'Message', { role: 'textarea' }),
    el(9, 'card', 'Card number', { form: 2, formMethod: 'post' }),
    el(10, 'submit', 'Continue', { form: 2, formMethod: 'post' }),
    el(11, 'button', 'Delete account'),
  ],
};

function fakeBrowser(page: PageSnapshot = SHOP) {
  const calls: string[] = [];
  let current: PageSnapshot | undefined;
  let visible = false;
  const b: Browser = {
    get visible() {
      return visible;
    },
    current: () => current,
    async open(url) {
      calls.push(`open ${url}`);
      current = { ...page, url };
      return current;
    },
    async snapshot() {
      current = page;
      return page;
    },
    async click(ref) {
      calls.push(`click ${ref}`);
      return page;
    },
    async type(ref, text, submit) {
      calls.push(`type ${ref} ${text}${submit ? ' enter' : ''}`);
      return page;
    },
    async search(q, n) {
      calls.push(`search ${q}`);
      return [{ title: 'Rye', url: 'https://rye.test', snippet: 'About rye' }].slice(0, n);
    },
    async show() {
      visible = true;
      calls.push('show');
    },
    async hide() {
      visible = false;
    },
    async close() {},
  };
  return { browser: b, calls };
}

const ctx = { signal: new AbortController().signal } as ToolContext;

function setup() {
  const { browser, calls } = fakeBrowser();
  const tools = Object.fromEntries(createBrowserTools(browser).map((t) => [t.name, t])) as Record<
    string,
    Tool
  >;
  const run = (name: string, args: unknown): Promise<ToolResult> =>
    (tools[name] as Tool).execute(args, ctx);
  return { browser, calls, tools, run };
}

describe('browser tools', () => {
  it('have the risks the plan sets', () => {
    const { tools } = setup();
    const risks = Object.fromEntries(Object.values(tools).map((t) => [t.name, t.risk]));
    expect(risks).toEqual({
      web_search: 'read',
      browser_open: 'read',
      browser_look: 'read',
      browser_click: 'read',
      browser_type: 'read',
      browser_act: 'send_as_user',
      browser_pay: 'spend_money',
      browser_show: 'read',
    });
    expect(tools.browser_act?.effect).toBe('unsafe_to_retry');
    expect(tools.browser_pay?.effect).toBe('unsafe_to_retry');
  });

  it('searches through the browser and marks results untrusted', async () => {
    const { run, calls } = setup();
    const r = await run('web_search', { query: 'rye bread' });
    expect(r).toMatchObject({ ok: true, trust: 'untrusted' });
    expect(r.ok && r.content).toContain('https://rye.test');
    expect(calls).toEqual(['search rye bread']);
  });

  it('opens a page and lists its controls', async () => {
    const { run } = setup();
    const r = await run('browser_open', { url: 'https://shop.test/cart' });
    expect(r).toMatchObject({ ok: true, trust: 'untrusted' });
    const text = r.ok ? r.content : '';
    expect(text).toContain('Page: Cart');
    expect(text).toContain('[1] link "Home" -> https://shop.test/');
    expect(text).toContain('[2] search box "Search"');
    expect(text).toContain('[3] textbox "Email" = "a@b.test"');
    expect(text).toContain('[4] password "Password" (the user types this: browser_show)');
    expect(text).toContain('[5] submit "Sign up" (sends: browser_act)');
    expect(text).toContain('[6] button "Buy now" (pays: browser_pay)');
    expect(text).toContain('[7] button "Show details"\n');
    expect(text).toContain('[10] submit "Continue" (pays: browser_pay)');
    expect(text).toContain('[11] button "Delete account" (sends: browser_act)');
  });

  it('opens only http and https', async () => {
    const { run, calls } = setup();
    expect(await run('browser_open', { url: 'file:///etc/passwd' })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('clicks links and harmless buttons', async () => {
    const { run, calls } = setup();
    expect(await run('browser_click', { ref: 1 })).toMatchObject({ ok: true });
    expect(await run('browser_click', { ref: 7 })).toMatchObject({ ok: true });
    expect(calls).toEqual(['click 1', 'click 7']);
  });

  it('refuses to click submit, action and money controls', async () => {
    const { run, calls } = setup();
    const signUp = await run('browser_click', { ref: 5 });
    expect(signUp).toMatchObject({ ok: false, phase: 'before_effect' });
    expect(!signUp.ok && signUp.error).toContain('browser_act');
    const buy = await run('browser_click', { ref: 6 });
    expect(!buy.ok && buy.error).toContain('browser_pay');
    expect(await run('browser_click', { ref: 11 })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('types into fields and submits only search boxes', async () => {
    const { run, calls } = setup();
    expect(await run('browser_type', { ref: 2, text: 'rye', submit: true })).toMatchObject({
      ok: true,
    });
    expect(await run('browser_type', { ref: 8, text: 'hello' })).toMatchObject({ ok: true });
    const enter = await run('browser_type', { ref: 8, text: 'hello', submit: true });
    expect(!enter.ok && enter.error).toContain('could send something');
    expect(await run('browser_type', { ref: 3, text: 'x', submit: true })).toMatchObject({
      ok: false,
    });
    expect(calls).toEqual(['type 2 rye enter', 'type 8 hello']);
  });

  it('never types passwords or card numbers', async () => {
    const { run, calls } = setup();
    const pw = await run('browser_type', { ref: 4, text: 'hunter2' });
    expect(!pw.ok && pw.error).toContain('browser_show');
    expect(await run('browser_type', { ref: 9, text: '4242' })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('acts only when the name still matches, and sends money to browser_pay', async () => {
    const { run, calls } = setup();
    const changed = await run('browser_act', { ref: 5, name: 'Delete' });
    expect(!changed.ok && changed.error).toContain('The page changed');
    const money = await run('browser_act', { ref: 6, name: 'Buy now' });
    expect(!money.ok && money.error).toContain('browser_pay');
    // A form holding a card field spends money whatever its button says.
    expect(await run('browser_act', { ref: 10, name: 'Continue' })).toMatchObject({ ok: false });
    expect(await run('browser_act', { ref: 5, name: 'sign  UP' })).toMatchObject({ ok: true });
    expect(await run('browser_pay', { ref: 6, name: 'Buy now' })).toMatchObject({ ok: true });
    expect(calls).toEqual(['click 5', 'click 6']);
  });

  it('previews an action with the page and the filled form', async () => {
    const { tools, browser } = setup();
    await browser.snapshot();
    expect(tools.browser_act?.preview({ ref: 5, name: 'Sign up' })).toBe(
      'Press "Sign up" on shop.test with Email: "a@b.test"',
    );
    expect(tools.browser_pay?.preview({ ref: 6, name: 'Buy now' })).toBe(
      'Pay: press "Buy now" on shop.test',
    );
  });

  it('shows the window and tells the model to ask the user', async () => {
    const { run, browser } = setup();
    const r = await run('browser_show', { reason: 'log in' });
    expect(r).toMatchObject({ ok: true, trust: 'trusted' });
    expect(r.ok && r.content).toContain('Ask the user to log in');
    expect(browser.visible).toBe(true);
  });

  it('caps page text and the control list', () => {
    const many = Array.from({ length: 130 }, (_, i) => el(i + 1, 'link', `L${i + 1}`));
    const out = renderSnapshot({
      url: 'https://x.test',
      title: 'X',
      text: 'a'.repeat(5000),
      elements: many,
    });
    expect(out).toContain('1000 more characters not shown');
    expect(out).toContain('… 10 more not shown');
  });
});
