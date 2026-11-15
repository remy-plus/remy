import { describe, expect, it } from 'vitest';
import { machineHasBrowser } from './browser-found.ts';

const base = { env: {}, home: '/home/p', exists: () => false, list: () => [] as string[] };

describe('machineHasBrowser', () => {
  it('says no on a clean Linux machine (a container with only Node)', () => {
    expect(machineHasBrowser({ ...base, platform: 'linux' })).toBe(false);
  });
  it('finds Chrome or Edge in the places Playwright launches them from', () => {
    for (const p of ['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'])
      expect(machineHasBrowser({ ...base, platform: 'linux', exists: (x) => x === p })).toBe(true);
  });
  it('finds the Chromium that remy browser install downloaded', () => {
    const seen: string[] = [];
    const list = (d: string) => {
      seen.push(d);
      return ['chromium-1234', 'ffmpeg-1011'];
    };
    expect(machineHasBrowser({ ...base, platform: 'linux', list })).toBe(true);
    expect(seen).toEqual(['/home/p/.cache/ms-playwright']);
    seen.length = 0;
    expect(
      machineHasBrowser({
        ...base,
        platform: 'linux',
        env: { PLAYWRIGHT_BROWSERS_PATH: '/pw' },
        list,
      }),
    ).toBe(true);
    expect(seen).toEqual(['/pw']);
  });
  it('does not take ffmpeg or an unrelated folder for a browser', () => {
    expect(
      machineHasBrowser({ ...base, platform: 'linux', list: () => ['ffmpeg-1011', 'firefox-9'] }),
    ).toBe(false);
  });
  it('checks the apps on a Mac, and stays off when the person turned the browser off', () => {
    expect(machineHasBrowser({ ...base, platform: 'darwin' })).toBe(false);
    expect(
      machineHasBrowser({ ...base, platform: 'darwin', exists: (x) => x.endsWith('Chrome.app') }),
    ).toBe(true);
    expect(
      machineHasBrowser({
        ...base,
        platform: 'linux',
        env: { REMY_BROWSER: 'off' },
        exists: () => true,
      }),
    ).toBe(false);
  });
});
