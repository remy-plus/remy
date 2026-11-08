// Size budget: the built folder, gzipped file by file, must stay under 250 KB.
// Fonts (woff2) are left out on purpose: they are self-hosted, cached, and load on demand.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET = 250 * 1024;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SKIP = new Set(['.woff', '.woff2', '.ttf', '.otf']);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

let total = 0;
for (const file of walk(dist)) {
  if (SKIP.has(extname(file))) continue;
  total += gzipSync(readFileSync(file), { level: 9 }).length;
}
const kb = (total / 1024).toFixed(1);
console.log(`web build: ${kb} KB gzipped (budget 250 KB, fonts excluded)`);
if (total > BUDGET) {
  console.error('The web build is over its size budget.');
  process.exit(1);
}
