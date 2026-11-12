import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listProposals, loadProposal, type Proposal, saveProposal } from './proposal.ts';

const proposal: Proposal = {
  version: 1,
  id: 'p1',
  createdAt: '2026-11-07T00:00:00Z',
  author: 'm',
  baseline: { journal: 'j', model: 'm' },
  suites: ['research'],
  edits: [],
  dropped: [],
  diff: '',
  editsHash: 'h',
  estimateUsd: 0,
  spentUsd: 0,
};

describe('proposal files', () => {
  it('saves and loads a proposal by id or path, and lists them', () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-home-'));
    expect(listProposals(home)).toEqual([]);
    const path = saveProposal(home, proposal);
    expect(path).toBe(join(home, 'improve', 'p1.json'));
    expect(loadProposal(home, 'p1').proposal).toEqual(proposal);
    expect(loadProposal(home, path).path).toBe(path);
    expect(listProposals(home)).toEqual(['p1.json']);
    expect(() => loadProposal(home, 'nope')).toThrow(/no proposal/);
  });

  it('refuses a file that is not a proposal', () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-home-'));
    saveProposal(home, { ...proposal, version: 2 } as unknown as Proposal);
    expect(() => loadProposal(home, 'p1')).toThrow(/not a proposal/);
  });

  it('still loads a file whose dropped edits have no text', () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-home-'));
    mkdirSync(join(home, 'improve'), { recursive: true });
    const old = {
      ...proposal,
      dropped: [{ id: 'finish', why: 'more than one prompt has that name' }],
    };
    writeFileSync(join(home, 'improve', 'p1.json'), JSON.stringify(old));
    expect(loadProposal(home, 'p1').proposal.dropped[0]?.to).toBeUndefined();
  });
});
