// What Remy can do on this machine right now, and for each thing it cannot, the one step the user
// takes to fix it. Built from the same checks as `remy doctor`, so the model says what is missing
// instead of guessing. It goes in the per-message situation block (setup can change between
// sessions), never the cached system prompt, and holds names and counts only: no keys or paths.

import type { TrustLevel } from '@remy/core';
import { type Facts, runChecks } from './doctor.ts';
import { trustCapability } from './trust.ts';

export interface CapabilityInput {
  facts: Facts;
  helpers: boolean;
  skills: number;
  trust?: TrustLevel;
}

/** The block never grows past this many lines. */
export const MAX_CAPABILITY_LINES = 8;

const ask = (fix: string | undefined) => (fix ? ` Ask the user: ${fix}` : '');

export function capabilitiesBlock(i: CapabilityInput): string {
  const checks = new Map(runChecks(i.facts).map((c) => [c.name, c]));
  const lines: string[] = ['Capabilities on this machine (from Remy):'];
  const search = checks.get('Search');
  if (search)
    lines.push(
      search.status === 'ok'
        ? `- Web search: ${search.detail}.`
        : `- Web search: ${search.detail}.${ask(search.fix)}`,
    );
  const browser = checks.get('Browser');
  if (browser)
    lines.push(
      browser.status === 'ok'
        ? '- Browser: available.'
        : `- Browser: ${browser.detail}.${ask(browser.fix)}`,
    );
  lines.push('- Files: the task workspace.');
  lines.push(
    '- Apps: only the connected ones listed above. For any other, such as email or calendar, ask the user to run `remy connect`.',
  );
  const schedules = checks.get('Schedules');
  if (schedules)
    lines.push(
      schedules.status === 'ok'
        ? `- Schedules: ${schedules.detail}.`
        : `- Schedules: ${schedules.detail}.${ask(schedules.fix)}`,
    );
  lines.push(
    i.helpers
      ? '- Helpers: on.'
      : '- Helpers: off. Ask the user to set REMY_HELPERS=on to use them.',
  );
  lines.push(`- Skills: ${i.skills}.`);
  if (i.trust && i.trust !== 'ask') lines.push(trustCapability(i.trust));
  return lines.slice(0, MAX_CAPABILITY_LINES + 1).join('\n');
}

/** Computes the block on first use and returns the same text for the rest of the process. */
export function onceCapabilities(build: () => string): () => string {
  let text: string | undefined;
  return () => (text ??= build());
}
