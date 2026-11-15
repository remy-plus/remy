import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CSS is not applied in these tests, so these read the source for the few rules a phone depends on.
const root = resolve(process.cwd(), 'src');
const css = readFileSync(join(root, 'index.css'), 'utf8');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });

describe('phone layout guards', () => {
  it('the skip link is drawn above the dock, which sits where the link appears on a phone', () => {
    const dock = readFileSync(join(root, 'components/Dock.tsx'), 'utf8');
    const dockZ = Number(/fixed top-3 left-1\/2 z-(\d+)/.exec(dock)?.[1]);
    const skipZ = Number(/\.skip-link \{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
    expect(dockZ).toBeGreaterThan(0);
    expect(skipZ).toBeGreaterThan(dockZ);
  });

  it('screens are as tall as the visible window, not the taller one under a phone address bar', () => {
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/min-h-screen|\b100vh\b/);
    }
  });
});
