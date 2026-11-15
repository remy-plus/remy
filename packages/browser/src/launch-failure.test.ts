import { describe, expect, it } from 'vitest';
import { explainLaunchFailure } from './driver.ts';

describe('explainLaunchFailure', () => {
  it('names the missing library and the one command that fixes it', () => {
    const log = [
      'browserType.launchPersistentContext: Target page, context or browser has been closed',
      'Browser logs:',
      '<launched> pid=325',
      '[pid=325][err] /root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell: error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory',
    ].join('\n');
    const out = explainLaunchFailure(log);
    expect(out).toContain('libnspr4.so');
    expect(out).toContain('sudo npx playwright install-deps chromium');
    expect(out).not.toContain('Target page');
  });
  it('understands the same problem when Playwright reports it as a missing dependency', () => {
    expect(
      explainLaunchFailure('Host system is missing dependencies to run browsers.\nplease install'),
    ).toContain('install-deps');
  });
  it('keeps the first line for any other failure', () => {
    expect(explainLaunchFailure('Something broke\nmore detail')).toBe('Something broke');
  });
});
