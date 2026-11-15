// Whether this machine has a browser Remy can drive, for `remy doctor` and the Settings page. The
// browser package launches Playwright's `chrome` and `msedge` channels, then the Chromium that
// `remy browser install` downloads, so these are the places it looks. Windows is not checked here: its
// installs live in several places, so it still answers yes and the first page opened says if it is wrong.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface BrowserSearch {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** The person's home folder (where Playwright keeps downloaded browsers). */
  home: string;
  exists?: (path: string) => boolean;
  list?: (dir: string) => string[];
}

const MAC = ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app'];
const LINUX = ['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'];

export function machineHasBrowser(s: BrowserSearch): boolean {
  const exists = s.exists ?? existsSync;
  if (s.env.REMY_BROWSER === 'off') return false;
  if (s.platform === 'darwin') return MAC.some(exists);
  if (s.platform !== 'linux') return true;
  if (LINUX.some(exists)) return true;
  // The Chromium `remy browser install` downloads (the Playwright cache, or where PLAYWRIGHT_BROWSERS_PATH says).
  const cache = s.env.PLAYWRIGHT_BROWSERS_PATH || join(s.home, '.cache', 'ms-playwright');
  const list =
    s.list ??
    ((d: string) => {
      try {
        return readdirSync(d);
      } catch {
        return [];
      }
    });
  return list(cache).some((n) => /^chromium(_headless_shell)?-\d+/.test(n));
}
