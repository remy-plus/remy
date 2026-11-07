import type { EvalCase, Suite } from './types.ts';

/** Group names that pick part of a suite: `live-hard` is the `live` cases whose id starts `live-hard-`. */
export const GROUPS: Record<string, { suite: Suite; prefix: string }> = {
  'live-hard': { suite: 'live', prefix: 'live-hard-' },
};

/**
 * Turns group names in --suite into a real suite plus the case ids of the group. A real suite named
 * next to its own group wins (`live,live-hard` runs all of live), and --case ids are kept.
 */
export const resolveGroups = (
  names: string[],
  caseIds: string[],
  cases: EvalCase[],
): { suites: string[]; caseIds: string[] } => {
  const suites = new Set<string>();
  const ids = new Set(caseIds);
  const grouped = new Set<string>();
  for (const n of names) {
    const g = GROUPS[n];
    if (!g) {
      suites.add(n);
      continue;
    }
    suites.add(g.suite);
    grouped.add(g.suite);
    for (const c of cases) if (c.suite === g.suite && c.id.startsWith(g.prefix)) ids.add(c.id);
  }
  // A whole suite asked for next to its group means no id filter from the group.
  if ([...grouped].some((s) => names.includes(s))) {
    for (const g of Object.values(GROUPS))
      for (const c of cases)
        if (c.id.startsWith(g.prefix) && !caseIds.includes(c.id)) ids.delete(c.id);
  }
  return { suites: [...suites], caseIds: [...ids] };
};
