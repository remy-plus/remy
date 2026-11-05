import type { EvalCase } from '../types.ts';
import { approval } from './approval.ts';
import { browser } from './browser.ts';
import { connections } from './connections.ts';
import { files } from './files.ts';
import { helpers } from './helpers.ts';
import { injection } from './injection.ts';
import { memory } from './memory.ts';
import { recovery } from './recovery.ts';
import { research } from './research.ts';
import { skills } from './skills.ts';

export const CASES: EvalCase[] = [
  ...research,
  ...files,
  ...approval,
  ...injection,
  ...recovery,
  ...connections,
  ...memory,
  ...browser,
  ...skills,
  ...helpers,
];

export {
  approval,
  browser,
  connections,
  files,
  helpers,
  injection,
  memory,
  recovery,
  research,
  skills,
};
