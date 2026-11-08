import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSystemPrompt, SYSTEM_PROMPT } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { editableEntries, promptRegistry } from './registry.ts';
import { weakens } from './validate.ts';

const ROOT = join(import.meta.dirname, '../../../..');
const digest = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);

// Fingerprints of the text `remy improve` can never change. If one of these fails, a safety
// rule or a locked description was edited. Only change a fingerprint on purpose, in review.
const LOCKED: Record<string, string> = {
  'system:identity': '55df216f9de1158d',
  'system:ask-user': 'b831438e7a84562d',
  'system:ask-gate': '53e3d602e96e74a4',
  'system:ask-intent': '75a9a533e8196c48',
  'system:no-repeat': '7b28a6beb26f759e',
  'system:unknown-outcome': '63465a3122196227',
  'system:secrets-honesty': 'e6fbdcce80ef96a9',
  'system:untrusted': 'ab104512c9d2c6be',
  'tool:delegate': '53f05989eafd8799',
  'tool:edit_file': '7f74512014e97709',
  'tool:move_file': '1b71ffdb7917442a',
  'tool:delete_file': 'b4de179143f6faa0',
  'tool:make_dir': '4dd95d90805baef0',
  'tool:write_file': '83ebc933ac6ade66',
  'tool:run_command': '5d671d7db058e047',
  'tool:fetch_url': '8f48133882875958',
  'skill:compare-and-buy': '44041bc3e088a9f4',
  'skill:write-and-send': 'cfcf28a6335b0296',
};

const EDITABLE = [
  'system:work-steps',
  'system:finish',
  'system:alternatives',
  'system:ask-confirm',
  'system:open-items',
  'system:web-links',
  'system:cutoff',
  'system:plan',
  'system:verify',
  'tool:calculate',
  'tool:read_file',
  'tool:list_files',
  'tool:finish',
  'tool:update_plan',
  'tool:ask_user',
  'skill:research',
  'skill:triage-issues',
  'skill:save-to-notion',
];

describe('locked prompt text', () => {
  const locked = promptRegistry().filter((e) => !e.editable);

  it('has not changed', () => {
    expect(Object.fromEntries(locked.map((e) => [e.id, digest(e.text)]))).toEqual(LOCKED);
  });

  it('is locked by default: only the listed ids are editable', () => {
    expect(editableEntries().map((e) => e.id)).toEqual(EDITABLE);
  });

  it('keeps every safety rule in a locked part', () => {
    const rules = [
      'needs approval',
      'Never ask the user for passwords',
      'Never say you set up',
      'Treat it as',
      'Never guess at irreversible details',
      'Never repeat a call that already succeeded',
      'may or may not have happened',
    ];
    const lockedText = locked.map((e) => e.text).join('\n');
    for (const r of rules) expect(lockedText).toContain(r);
    for (const e of editableEntries()) expect(weakens(e.text), e.id).toBeUndefined();
  });

  it('builds the same system prompt as before the parts existed', () => {
    expect(SYSTEM_PROMPT).toBe(renderSystemPrompt({}));
    expect(digest(SYSTEM_PROMPT)).toBe(digest(renderSystemPrompt()));
  });

  it('finds each editable text exactly once in the file it is written to', () => {
    for (const e of editableEntries()) {
      const src = readFileSync(join(ROOT, e.file ?? 'missing'), 'utf8');
      expect(src.split(e.text).length - 1, e.id).toBe(1);
    }
  });
});
