// Writes release/remy.js, the published bin: it sets NODE_ENV before the bundle (release/main.js)
// loads React, for the same reason as src/main.ts.
import { chmodSync, writeFileSync } from 'node:fs';

const bin = new URL('../release/remy.js', import.meta.url);
writeFileSync(
  bin,
  "#!/usr/bin/env node\nprocess.env.NODE_ENV ??= 'production';\nawait import('./main.js');\n",
);
chmodSync(bin, 0o755);
