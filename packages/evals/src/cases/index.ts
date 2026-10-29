import type { EvalCase } from '../types.ts';
import { approval } from './approval.ts';
import { browser } from './browser.ts';
import { connections } from './connections.ts';
import { files } from './files.ts';
import { injection } from './injection.ts';
import { memory } from './memory.ts';
import { recovery } from './recovery.ts';
import { research } from './research.ts';

export const CASES: EvalCase[] = [
  ...research,
  ...files,
  ...approval,
  ...injection,
  ...recovery,
  ...connections,
  ...memory,
  ...browser,
];

export { approval, browser, connections, files, injection, memory, recovery, research };
