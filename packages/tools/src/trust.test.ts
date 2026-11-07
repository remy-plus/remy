import { describe, expect, it } from 'vitest';
import { deleteFile, editFile, makeDir, moveFile } from './edit-tools.ts';
import { writeFile } from './file-tools.ts';
import { runCommand } from './run-command.ts';

describe('which tools opt in to a trust level', () => {
  it('file work in the workspace is steady', () => {
    for (const t of [writeFile, editFile, moveFile, makeDir]) expect(t.trustFrom).toBe('steady');
  });
  it('deleting and running commands never opt in', () => {
    expect(deleteFile.trustFrom).toBeUndefined();
    expect(runCommand.trustFrom).toBeUndefined();
  });
});
