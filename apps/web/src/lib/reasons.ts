// Why Remy is asking, in plain words. The policy writes its reason for the log and the terminal
// ("Changing files or data isn't auto-approved"); this turns the ones a person can meet into
// sentences that say what Remy will do. Any other reason is shown as it came, so nothing is lost.
// The policy's text is unchanged: only what the person sees is mapped.

const ACTION: Record<string, string> = {
  'Changing files or data': 'changing files',
  'Sending something as you': 'sending anything as you',
  'Spending money': 'spending money',
  'An action that cannot be undone': 'anything that cannot be undone',
};

const OUTSIDE = 'Remy read something from outside';

export function plainApprovalReason(reason: string): string {
  const asks = /^(.+) isn't auto-approved$/.exec(reason);
  if (asks && ACTION[asks[1] as string]) return `Remy asks before ${ACTION[asks[1] as string]}.`;

  const always = /^(.+) always needs your approval$/.exec(reason);
  if (always && ACTION[always[1] as string])
    return `Remy always asks before ${ACTION[always[1] as string]}.`;

  if (reason.startsWith('this task read untrusted content')) {
    if (reason.includes('opens an address'))
      return `${OUTSIDE}, and this opens an address it was not given, so it asks first.`;
    if (reason.includes('sends words you did not give'))
      return `${OUTSIDE}, and this would send words you did not write to a form on that page, so it asks first.`;
    return `${OUTSIDE} (a web page, search result, email or pasted text), so it asks before doing more than reading.`;
  }
  return reason;
}
