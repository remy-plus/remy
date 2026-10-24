#!/usr/bin/env node
import { parseArgs } from 'node:util';

const VERSION = '0.0.0';

const { values } = parseArgs({
  options: { version: { type: 'boolean', short: 'v' } },
  strict: false,
});

if (values.version) {
  console.log(`remy ${VERSION}`);
} else {
  console.log('remy: no commands yet. Phase 0 is in progress.');
}
