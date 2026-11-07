// Trust levels as the user meets them: the words for /trust and `remy trust`. What each level
// clears is decided in core (`decide`) from the tools' `trustFrom`; this only describes it.
import { isTrustLevel, TRUST_LEVELS, type TrustLevel } from '@remy/core';

export { isTrustLevel, TRUST_LEVELS, type TrustLevel };

const BLURB: Record<TrustLevel, string> = {
  ask: 'asks before changing anything (default)',
  steady:
    'goes ahead with low-risk, reversible work: files in the workspace, saving notes, adding a schedule',
  away: 'steady, plus saving skills; meant for long runs while you are away',
};

const ALWAYS_ASK =
  'At every level Remy still asks before spending money, sending or posting as you, deleting, running commands, or anything after it has read a web page or other untrusted content. Apps you connect keep following /approvals.';

/** The text for `/trust` and `remy trust` with no argument. */
export function trustSummary(current: TrustLevel): string {
  const rows = TRUST_LEVELS.map((l) => `${l === current ? '*' : ' '} ${l.padEnd(7)}${BLURB[l]}`);
  return `${rows.join('\n')}\n${ALWAYS_ASK}\nA change applies to new tasks; a task already running keeps its level.`;
}

export const trustChanged = (level: TrustLevel) =>
  `Trust is now ${level}: Remy ${BLURB[level]}. It applies to new tasks.`;

/** The line in the capabilities block. */
export const trustCapability = (level: TrustLevel) =>
  level === 'ask'
    ? '- Trust: ask. Every change waits for the user to approve it.'
    : `- Trust: ${level}. File work in the workspace, notes and schedules go ahead without a card; sending, spending, deleting, commands and anything after untrusted content still wait for approval.`;
