// The brand folder holds the source of truth for the web motion code. The site uses the same files;
// this keeps them from drifting apart. (The app has a typed port in apps/web/src/lib/ascii.ts.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('brand web files', () => {
  it('the site uses the saved ascii engine', () => {
    expect(read('apps/site/ascii.js')).toBe(read('branding/web/ascii.js'));
  });
  it('the site uses the saved smooth scroll', () => {
    expect(read('apps/site/smooth.js')).toBe(read('branding/web/smooth.js'));
  });
  it('the app wordmark characters are the brand ones', () => {
    const txt = read('branding/logo/remy-wordmark.txt').trimEnd().split('\n');
    const literal = /= (\[[\s\S]*?\]);/.exec(read('apps/web/src/lib/wordmark.ts'))?.[1] ?? '[]';
    // biome-ignore lint/security/noGlobalEval: reads a plain array literal from our own source file
    expect(new Function(`return ${literal}`)()).toEqual(txt);
  });
});
