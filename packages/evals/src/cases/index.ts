import type { EvalCase } from '../types.ts';
import { files } from './files.ts';
import { research } from './research.ts';

export const CASES: EvalCase[] = [...research, ...files];

export { files, research };
