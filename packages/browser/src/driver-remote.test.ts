import { afterEach, describe, expect, it, vi } from 'vitest';

const launch = vi.fn();
const connect = vi.fn();
vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: launch, connectOverCDP: connect },
}));

import { createLocalBrowser } from './driver.ts';
import type { RemoteSessionProvider } from './remote.ts';

function fakeContext() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const page = {
    isClosed: () => false,
    url: () => 'about:blank',
    title: async () => '',
    waitForLoadState: async () => {},
    goto: async () => {},
    evaluate: async () => ({ url: 'https://example.com/', title: 'T', text: 'hi', elements: [] }),
  };
  return {
    setDefaultNavigationTimeout: () => {},
    setDefaultTimeout: () => {},
    on: (e: string, h: (...a: unknown[]) => void) => {
      handlers[e] = h;
    },
    route: vi.fn(async () => {}),
    pages: () => [page],
    newPage: async () => page,
    close: async () => {},
  };
}

function provider(opts: { close: () => Promise<void>; cdpUrl?: string }): RemoteSessionProvider {
  return {
    id: 'steel',
    label: 'Steel',
    createSession: async () => ({
      cdpUrl: opts.cdpUrl ?? 'wss://connect.steel.dev?apiKey=KEY123&sessionId=s1',
      sessionId: 's1',
      close: opts.close,
    }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('remote driver', () => {
  it('connects over CDP instead of launching, once, and guards navigation', async () => {
    const ctx = fakeContext();
    connect.mockResolvedValue({ contexts: () => [ctx], newContext: async () => ctx });
    const close = vi.fn(async () => {});
    const b = createLocalBrowser({ profileDir: '/nonexistent', remote: provider({ close }) });
    expect(b.notice).toBe("Pages open in Steel's cloud browser, not on this computer.");
    await b.open('https://example.com/');
    await b.snapshot();
    expect(launch).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0]?.[0]).toContain('connect.steel.dev');
    expect(ctx.route).toHaveBeenCalled(); // local-address guard is installed
    await b.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the key out of a connection failure and releases the session', async () => {
    connect.mockRejectedValue(
      new Error('connect failed wss://connect.steel.dev?apiKey=KEY123&sessionId=s1'),
    );
    const close = vi.fn(async () => {});
    const b = createLocalBrowser({ profileDir: '/nonexistent', remote: provider({ close }) });
    const err = (await b.open('https://example.com/').catch((e: Error) => e)) as Error;
    expect(err.message).toContain('Steel started a session');
    expect(err.message).not.toContain('KEY123');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('has no window to show', async () => {
    const ctx = fakeContext();
    connect.mockResolvedValue({ contexts: () => [ctx], newContext: async () => ctx });
    const b = createLocalBrowser({
      profileDir: '/nonexistent',
      remote: provider({ close: async () => {} }),
    });
    await b.open('https://example.com/');
    await expect(b.show()).rejects.toThrow(/cloud browser/);
  });

  it('releases the session after the idle time', async () => {
    vi.useFakeTimers();
    const ctx = fakeContext();
    connect.mockResolvedValue({ contexts: () => [ctx], newContext: async () => ctx });
    const close = vi.fn(async () => {});
    const b = createLocalBrowser({
      profileDir: '/nonexistent',
      remote: provider({ close }),
      idleMs: 1000,
    });
    await b.snapshot();
    await vi.advanceTimersByTimeAsync(999);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('an engine on this computer says so, not "cloud", and has no window or profile', async () => {
    const ctx = fakeContext();
    connect.mockResolvedValue({ contexts: () => [ctx], newContext: async () => ctx });
    const close = vi.fn(async () => {});
    const b = createLocalBrowser({
      profileDir: '/nonexistent',
      remote: {
        ...provider({ close }),
        id: 'lightpanda',
        label: 'Lightpanda',
        notice: 'Pages open in Lightpanda.',
        noWindow: 'Lightpanda has no window to show.',
      },
    });
    expect(b.notice).toBe('Pages open in Lightpanda.');
    await b.open('https://example.com/');
    const err = (await b.show().catch((e: Error) => e)) as Error;
    expect(err.message).toContain('Lightpanda has no window to show.');
    expect(err.message).not.toMatch(/cloud/);
    await b.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback notice when Chrome is used instead of an engine that was asked for', () => {
    const b = createLocalBrowser({ profileDir: '/nonexistent', fallbackNotice: 'Using Chrome.' });
    expect(b.notice).toBe('Using Chrome.');
  });
});
