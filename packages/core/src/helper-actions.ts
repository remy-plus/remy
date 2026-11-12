// What a parent knows about changes its helpers made. Pure: read from the `delegate` results.
import type { CallState } from './state.ts';
import type { HelperAction } from './types.ts';

export const DELEGATE_TOOL = 'delegate';

/** Changes helpers made or may have made, as recorded in the parent's finished `delegate` calls. */
export function helperActionsOf(calls: Record<string, CallState> | undefined): HelperAction[] {
  const out: HelperAction[] = [];
  for (const c of Object.values(calls ?? {})) {
    if (c.tool !== DELEGATE_TOOL || !c.result?.ok) continue;
    const actions = (c.result.data as { actions?: HelperAction[] } | undefined)?.actions;
    if (Array.isArray(actions)) out.push(...actions);
  }
  return out;
}

/** The plain sentence a model reads: what the helper did, or may have done, and what not to do. */
export function describeAction(a: HelperAction): string {
  return a.outcome === 'done'
    ? `This already happened (done by the helper, approved by the person): ${a.preview}. Do not do it again.`
    : `OUTCOME UNKNOWN: the helper was interrupted during this and could not confirm it: ${a.preview}. It may already have happened. Do not do it again. Tell the person it may or may not have happened and let them check.`;
}
