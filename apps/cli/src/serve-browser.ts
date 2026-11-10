// `remy serve` routes that let the web app mirror Remy's own browser (never the person's Chrome).
//
//   GET /api/browser/state   { open, url?, title? }; { open: false } when no page is open (200)
//   GET /api/browser/frame   the page as image/jpeg, no-store; 204 when no browser is open
//
// Both are read-only: they never start the browser, navigate, click or type. Frames are taken at
// most 4 times a second; a request that comes sooner gets the last frame.
import type { Browser } from '@remy/browser';
import { type Mount, methodNotAllowed, ok } from './serve-mount.ts';
import type { Redact } from './serve-view.ts';

export const FRAME_MIN_INTERVAL_MS = 250;

export interface BrowserMountDeps {
  /** Remy's browser if this process has started one; must not start it. */
  browser(): Browser | undefined;
  redact: Redact;
  now?: () => number;
}

export function createBrowserMount(deps: BrowserMountDeps): Mount {
  const now = deps.now ?? Date.now;
  let cached: { at: number; frame: Buffer | undefined } | undefined;
  let taking: Promise<Buffer | undefined> | undefined;

  async function frame(b: Browser): Promise<Buffer | undefined> {
    if (cached && now() - cached.at < FRAME_MIN_INTERVAL_MS) return cached.frame;
    taking ??= b.screenshot().finally(() => {
      taking = undefined;
    });
    const f = await taking;
    cached = { at: now(), frame: f };
    return f;
  }

  return async ({ method, parts }) => {
    if (parts[0] !== 'browser' || parts.length !== 2) return undefined;
    if (method !== 'GET') return methodNotAllowed('GET');
    const b = deps.browser();
    if (parts[1] === 'state') {
      const s = b ? await b.state() : undefined;
      if (!s?.open) return ok({ open: false });
      return ok({ open: true, url: deps.redact(s.url), title: deps.redact(s.title) });
    }
    if (parts[1] === 'frame') {
      const f = b ? await frame(b) : undefined;
      if (!f) return { status: 204 };
      return { status: 200, body: f, headers: { 'content-type': 'image/jpeg' } };
    }
    return undefined;
  };
}
