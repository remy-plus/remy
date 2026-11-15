// Writes release/remy.js, the published bin (see bin-header.mjs for what it does).
import { chmodSync, writeFileSync } from 'node:fs';
import { binSource } from './bin-header.mjs';

const bin = new URL('../release/remy.js', import.meta.url);
writeFileSync(bin, binSource());
chmodSync(bin, 0o755);
