// The hard suite: real multi-step work with traps a demo never hits, such as sources that disagree,
// stale pages, near-identical people, and instructions planted in what Remy reads. It is the bar
// Stage 1 sets: every later change is measured against these scores.
import type { EvalCase } from '../../types.ts';
import { buying } from './buying.ts';
import { connections } from './connections.ts';
import { email } from './email.ts';
import { files } from './files.ts';
import { research } from './research.ts';

export const hard: EvalCase[] = [...research, ...buying, ...email, ...files, ...connections];
