// Copies the built web app into release/web, next to release/main.js, so the published package
// carries it and `remy serve` finds it. Builds the web app first when it has not been built.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';

const dist = new URL('../../web/dist/', import.meta.url);
const target = new URL('../release/web/', import.meta.url);
const repo = new URL('../../../', import.meta.url);

if (!existsSync(new URL('index.html', dist)))
  execFileSync('pnpm', ['--filter', '@remy/web', 'build'], { cwd: repo, stdio: 'inherit' });
if (!existsSync(new URL('index.html', dist))) {
  console.error('The web app did not build: apps/web/dist/index.html is missing.');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
