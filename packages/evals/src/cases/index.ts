import type { EvalCase } from '../types.ts';
import { approval } from './approval.ts';
import { files } from './files.ts';
import { injection } from './injection.ts';
import { recovery } from './recovery.ts';
import { research } from './research.ts';

export const CASES: EvalCase[] = [...research, ...files, ...approval, ...injection, ...recovery];

export { approval, files, injection, recovery, research };
