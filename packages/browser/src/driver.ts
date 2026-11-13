import { promises as dns } from 'node:dns';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrivateAddress } from '@remy/tools';
import type { BrowserContext, Page } from 'playwright-core';
import type { Browser, PageSnapshot, SearchHit } from './port.ts';
import {
  type RemoteSession,
  type RemoteSessionProvider,
  redactSecrets,
  remoteNotice,
} from './remote.ts';
import {
  BotCheckError,
  firstUseful,
  looksLikeBotCheck,
  rephrased,
  rereadAfterNavigation,
} from './results.ts';
import { BING_RESULTS_SCRIPT, DDG_RESULTS_SCRIPT, SNAPSHOT_SCRIPT } from './walker.ts';

export interface LocalBrowserOptions {
  /** Remy's own profile (cookies, logins). Never the user's everyday browser profile. */
  profileDir: string;
  /** Start with a window. Default false: hidden until `show`. */
  visible?: boolean;
  /** Browsers to try in order. Default: installed Chrome, Edge, then Playwright's Chromium. */
  channels?: (string | undefined)[];
  /** Let pages open loopback and private-network addresses. Default false. */
  allowLocal?: boolean;
  /** Only these domains (exact or subdomain) open, like `--net-allow`. Default: any. */
  allow?: string[];
  navigationTimeoutMs?: number;
  /** Drive a cloud browser instead of launching Chrome here. One session, started on first use. */
  remote?: RemoteSessionProvider;
  /** Said in the browser's status when Remy fell back to Chrome from an engine that was asked for. */
  fallbackNotice?: string;
  /** Release the remote session after this long unused. Default 5 minutes. */
  idleMs?: number;
}

export const NO_BROWSER =
  'Remy found no browser to use. Install Google Chrome, or run remy browser install.';

const MISSING = /Executable doesn't exist|is not found|not installed|ENOENT/i;
const LOCK = '.remy-lock';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True when another live Remy process holds the profile. */
export function profileInUse(dir: string): boolean {
  const file = join(dir, LOCK);
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8'));
  return Number.isInteger(pid) && pid !== process.pid && pidAlive(pid);
}

async function isLocalHost(host: string): Promise<boolean> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (isIP(bare)) return isPrivateAddress(bare);
  try {
    const found = await dns.lookup(bare, { all: true });
    return found.some((a) => isPrivateAddress(a.address));
  } catch {
    return false; // the browser reports the failed lookup itself
  }
}

export function createLocalBrowser(opts: LocalBrowserOptions): Browser {
  let api: Browser | undefined;
  const navTimeout = opts.navigationTimeoutMs ?? 30_000;
  let ctx: BrowserContext | undefined;
  let page: Page | undefined;
  let visible = opts.visible ?? false;
  let last: PageSnapshot | undefined;
  let profile: string | undefined;
  let refusedHost: string | undefined; // set when the allowlist, not the local rule, blocked a page
  let ownTab = 0; // tabs Remy opens itself (search), which must not become the current page

  let session: RemoteSession | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const idleMs = opts.idleMs ?? 300_000;

  /** Remote only: restarts the idle timer on every use. */
  function touch(): void {
    if (!opts.remote) return;
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => void api?.close(), idleMs);
    idle.unref?.();
  }

  /** Same page rules for both kinds of browser: new tabs, window closed, address checks. */
  async function guard(c: BrowserContext): Promise<void> {
    c.setDefaultNavigationTimeout(navTimeout);
    c.setDefaultTimeout(10_000);
    c.on('page', (p) => {
      if (ownTab === 0) page = p; // a link that opened a new tab: follow it
    });
    c.on('close', () => {
      // The window was closed (or the cloud session ended): start fresh next time.
      if (ctx === c) {
        ctx = undefined;
        page = undefined;
        if (!opts.remote) visible = false;
        else {
          const s = session;
          session = undefined;
          void s?.close();
        }
      }
    });
    const allow = opts.allow;
    if (!opts.allowLocal || allow)
      await c.route('**/*', async (route) => {
        const req = route.request();
        if (!req.isNavigationRequest()) return route.continue();
        // Chrome lets through addresses Node cannot read, such as one with a space in its host.
        const url = URL.canParse(req.url()) ? new URL(req.url()) : undefined;
        if (!url) return route.abort('blockedbyclient');
        if (!/^https?:$/.test(url.protocol)) return route.continue();
        const host = url.hostname;
        if (allow && !allow.some((d) => host === d || host.endsWith(`.${d}`))) {
          refusedHost = host;
          return route.abort('blockedbyclient');
        }
        if (!opts.allowLocal && (await isLocalHost(host))) return route.abort('blockedbyclient');
        return route.continue();
      });
  }

  async function connectRemote(remote: RemoteSessionProvider): Promise<BrowserContext> {
    const { chromium } = await import('playwright-core');
    const made = await remote.createSession();
    const secrets = [made.cdpUrl, new URL(made.cdpUrl).searchParams.get('apiKey') ?? undefined];
    try {
      const b = await chromium.connectOverCDP(made.cdpUrl, { timeout: navTimeout });
      const c = b.contexts()[0] ?? (await b.newContext());
      session = made;
      await guard(c);
      return c;
    } catch (e) {
      session = undefined;
      await made.close();
      const msg = redactSecrets(e instanceof Error ? e.message : String(e), secrets);
      throw new Error(
        `${remote.label} started a session but Remy could not connect to it: ${msg.split('\n')[0]}`,
      );
    }
  }

  async function launch(): Promise<BrowserContext> {
    if (opts.remote) return connectRemote(opts.remote);
    if (!profile) {
      mkdirSync(opts.profileDir, { recursive: true });
      // A background task can run while the chat has the profile open: it gets a fresh one.
      profile = profileInUse(opts.profileDir)
        ? mkdtempSync(join(tmpdir(), 'remy-browser-'))
        : opts.profileDir;
      writeFileSync(join(profile, LOCK), String(process.pid));
    }
    // Loaded on first use: Playwright is large and most turns never open a page.
    const { chromium } = await import('playwright-core');
    let failure: string | undefined;
    for (const channel of opts.channels ?? ['chrome', 'msedge', undefined]) {
      try {
        const c = await chromium.launchPersistentContext(profile, {
          headless: !visible,
          ...(channel && { channel }),
          ...(visible ? { viewport: null } : { viewport: { width: 1280, height: 900 } }),
        });
        await guard(c);
        return c;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!MISSING.test(msg)) failure ??= msg.split('\n')[0];
      }
    }
    throw new Error(failure ? `The browser did not start: ${failure}` : NO_BROWSER);
  }

  async function context(): Promise<BrowserContext> {
    touch();
    ctx ??= await launch();
    return ctx;
  }

  async function currentPage(): Promise<Page> {
    const c = await context();
    if (!page || page.isClosed())
      page = c.pages().find((p) => !p.isClosed()) ?? (await c.newPage());
    return page;
  }

  async function settle(p: Page): Promise<void> {
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {});
  }

  async function snap(): Promise<PageSnapshot> {
    const p = await currentPage();
    last = (await p.evaluate(SNAPSHOT_SCRIPT)) as PageSnapshot;
    return last;
  }

  async function element(ref: number) {
    const p = await currentPage();
    const loc = p.locator(`[data-remy-ref="${ref}"]`);
    if ((await loc.count()) === 0)
      throw new Error(
        `There is no element [${ref}] on the page now. Look at the latest page first.`,
      );
    return { p, loc };
  }

  async function navigate(p: Page, url: string): Promise<void> {
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      if (/ERR_BLOCKED_BY_CLIENT/.test(msg ?? '')) {
        const host = refusedHost;
        refusedHost = undefined;
        throw new Error(
          host
            ? `${host} is not on this task's list of allowed sites.`
            : `${url} is on this computer or its local network, which Remy does not open.`,
        );
      }
      throw new Error(`Could not open ${url}: ${msg}`);
    }
  }

  /** Relaunches the same profile with or without a window, on the same page. */
  async function relaunch(show: boolean): Promise<void> {
    if (opts.remote) {
      const where = session?.viewerUrl ? ` You can watch it at ${session.viewerUrl}.` : '';
      throw new Error(
        opts.remote.noWindow
          ? `${opts.remote.noWindow} Ask the person to do this step themselves, or to turn off the engine.`
          : `${remoteNotice(opts.remote.label)} There is no window to show here.${where} Ask the person to do this step themselves, or to turn off REMY_BROWSER.`,
      );
    }
    if (visible === show && ctx) return;
    const url = page && !page.isClosed() ? page.url() : undefined;
    const old = ctx;
    ctx = undefined;
    page = undefined;
    last = undefined;
    await old?.close().catch(() => {});
    visible = show;
    const p = await currentPage();
    if (url && url !== 'about:blank') {
      await navigate(p, url);
      await settle(p);
    }
    if (show) await p.bringToFront();
  }

  /** The page Remy already has open; unlike `currentPage`, never starts a browser or a tab. */
  function livePage(): Page | undefined {
    return ctx && page && !page.isClosed() ? page : undefined;
  }

  api = {
    get notice() {
      return opts.remote
        ? (opts.remote.notice ?? remoteNotice(opts.remote.label))
        : opts.fallbackNotice;
    },
    async state() {
      const p = livePage();
      if (!p) return { open: false, url: '', title: '' };
      return { open: true, url: p.url(), title: await p.title().catch(() => '') };
    },
    async screenshot() {
      const p = livePage();
      if (!p) return undefined;
      return p.screenshot({ type: 'jpeg', quality: 60 }).catch(() => undefined);
    },
    get visible() {
      return visible && ctx !== undefined;
    },
    current: () => last,
    async open(url) {
      if (!URL.canParse(url) || /\s/.test(url.trim()))
        throw new Error(`"${url}" is not a valid address. Copy it from the search results.`);
      const p = await currentPage();
      await navigate(p, url);
      await settle(p);
      return snap();
    },
    snapshot: snap,
    async click(ref) {
      const { loc } = await element(ref);
      await loc.click();
      await new Promise((r) => setTimeout(r, 300)); // a new tab announces itself after the click
      await settle(await currentPage());
      return snap();
    },
    async type(ref, text, submit) {
      const { loc } = await element(ref);
      if ((await loc.evaluate((e) => (e as { tagName: string }).tagName)) === 'SELECT')
        await loc.selectOption({ label: text }).catch(() => loc.selectOption(text));
      else await loc.fill(text);
      if (submit) {
        await loc.press('Enter');
        await new Promise((r) => setTimeout(r, 300));
        await settle(await currentPage());
      }
      return snap();
    },
    async search(query, count) {
      const c = await context();
      ownTab++;
      const tab = await c.newPage().finally(() => ownTab--);
      try {
        // Bing first: DuckDuckGo shows a hidden browser a CAPTCHA, a shown one usually not.
        const q = encodeURIComponent(query);
        const read = (script: string) =>
          rereadAfterNavigation(
            () => tab.evaluate(script) as Promise<SearchHit[] | null>,
            () => settle(tab),
          );
        const engine = (url: string, script: string) => async () => {
          await navigate(tab, url);
          await settle(tab);
          const hits = await read(script);
          if (!hits?.length) {
            const text = (await tab.evaluate("document.body?.innerText ?? ''")) as string;
            if (looksLikeBotCheck(await tab.title(), text)) throw new BotCheckError();
          }
          return hits;
        };
        const bing = (text: string) =>
          engine(`https://www.bing.com/search?q=${encodeURIComponent(text)}`, BING_RESULTS_SCRIPT);
        const other = rephrased(query);
        const hits = await firstUseful(query, [
          bing(query),
          ...(other ? [bing(other)] : []),
          engine(`https://html.duckduckgo.com/html/?q=${q}`, DDG_RESULTS_SCRIPT),
        ]);
        return hits.slice(0, count);
      } finally {
        await tab.close().catch(() => {});
      }
    },
    show: () => relaunch(true),
    hide: () => relaunch(false),
    async close() {
      const c = ctx;
      const s = session;
      ctx = undefined;
      page = undefined;
      session = undefined;
      if (idle) clearTimeout(idle);
      idle = undefined;
      await c?.close().catch(() => {});
      await s?.close();
      if (!profile) return;
      if (profile === opts.profileDir) rmSync(join(profile, LOCK), { force: true });
      else rmSync(profile, { recursive: true, force: true });
      profile = undefined;
    },
  };
  return api;
}
