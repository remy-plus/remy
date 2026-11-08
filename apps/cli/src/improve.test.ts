import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { editsHash, loadProposal, type RunRecord, saveProposal } from '@remy/evals';
import { DEFAULT_CAPS, ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';

const REPO = join(import.meta.dirname, '../../..');
const dir = () => mkdtempSync(join(tmpdir(), 'remy-improve-'));

const failed = {
  caseId: 'lookup',
  suite: 'research',
  run: 0,
  pass: false,
  failure: 'wrong_answer',
  costUsd: 0,
  grades: [{ name: 'answerContains', pass: false, detail: 'missing 1974', safety: false }],
} as unknown as RunRecord;

function setup(model?: ScriptedModelClient, extra: Partial<CliDeps> = {}) {
  const home = dir();
  const journal = join(home, 'j.jsonl');
  writeFileSync(journal, `${JSON.stringify(failed)}\n`);
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home },
    cwd: home,
    out: (s) => {
      o.out += s;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store: new MemoryEventStore(),
    ...(model && { model }),
    ...extra,
  };
  const run = async (...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, deps);
    return { code, out: o.out, err: o.err };
  };
  return { home, journal, run };
}

const good = {
  id: 'system:finish',
  to: 'When the task is complete, call finish with the outcome first, in a sentence or two.',
  reason: 'Answers ran long.',
  cases: ['lookup'],
};
const reply = (...edits: unknown[]) => ({
  text: JSON.stringify({ edits }),
  calls: [],
  usage: { inTokens: 500, outTokens: 100 },
});

describe('remy improve propose', () => {
  it('prints the estimate, saves a proposal in REMY_HOME/improve and applies nothing', async () => {
    const model = new ScriptedModelClient([
      reply(good, { id: 'system:untrusted', to: 'x', reason: 'x', cases: ['lookup'] }),
    ]);
    const s = setup(model);
    const r = await s.run('improve', 'propose', '--from', s.journal, '--max-usd', '1');
    expect(r.code).toBe(0);
    expect(r.out.indexOf('Estimated cost')).toBeLessThan(r.out.indexOf('+ When the task'));
    expect(r.out).toContain('Dropped system:untrusted: locked');
    const files = readdirSync(join(s.home, 'improve'));
    expect(files).toHaveLength(1);
    const p = loadProposal(s.home, files[0] as string).proposal;
    expect(p.edits.map((e) => e.id)).toEqual(['system:finish']);
    expect(p.verdict).toBeUndefined();
  });

  it('stops at the cap before calling the model', async () => {
    const pricey = { ...DEFAULT_CAPS, pricing: { inPerMTok: 1e6, outPerMTok: 1e6 } };
    const model = new ScriptedModelClient([reply(good)], { caps: pricey });
    const s = setup(model);
    const r = await s.run('improve', 'propose', '--from', s.journal, '--max-usd', '0.01');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('Nothing was spent');
    expect(model.requests).toHaveLength(0);
  });

  it('needs a journal and a cap', async () => {
    const s = setup(new ScriptedModelClient([]));
    expect((await s.run('improve', 'propose', '--max-usd', '1')).code).not.toBe(0);
    expect((await s.run('improve', 'propose', '--from', s.journal)).err).toContain('--max-usd');
  });
});

describe('remy improve apply', () => {
  const proposalWith = (home: string, verdict: boolean) => {
    const from = readFileSync(join(REPO, 'packages/core/src/messages.ts'), 'utf8').includes(
      'When the task is complete, call finish with a short answer that states the outcome first.',
    )
      ? 'When the task is complete, call finish with a short answer that states the outcome first.'
      : '';
    const edits = [{ ...good, from }];
    const h = editsHash(edits);
    saveProposal(home, {
      version: 1,
      id: 'p1',
      createdAt: '2026-11-07T00:00:00Z',
      author: 'm',
      baseline: { journal: 'j', model: 'm' },
      suites: ['research'],
      edits,
      dropped: [],
      diff: '',
      editsHash: h,
      estimateUsd: 0,
      spentUsd: 0,
      ...(verdict && {
        verdict: {
          passed: true,
          at: 'x',
          model: 'm',
          suites: ['research'],
          editsHash: h,
          reasons: [],
          targets: { before: 0, after: 1, runs: 1 },
          spentUsd: 0,
        },
      }),
    });
  };

  it('refuses a proposal that has not passed a check', async () => {
    const s = setup();
    proposalWith(s.home, false);
    const r = await s.run('improve', 'apply', 'p1');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('no passing check');
  });

  it('shows the diff, waits for a typed yes, and writes without committing', async () => {
    const answers = ['no', 'yes'];
    const s = setup(undefined, { isTTY: true, ask: async () => answers.shift() ?? null });
    // The command writes into the folder it runs from, so the test folder holds a copy of the file.
    const file = 'packages/core/src/messages.ts';
    mkdirSync(dirname(join(s.home, file)), { recursive: true });
    cpSync(join(REPO, file), join(s.home, file));
    proposalWith(s.home, true);
    const declined = await s.run('improve', 'apply', 'p1');
    expect(declined.code).toBe(1);
    expect(declined.out).toContain('Nothing changed');
    expect(readFileSync(join(s.home, file), 'utf8')).not.toContain('in a sentence or two');
    const done = await s.run('improve', 'apply', 'p1');
    expect(done.code).toBe(0);
    expect(done.out).toContain('Nothing was committed');
    expect(readFileSync(join(s.home, file), 'utf8')).toContain('in a sentence or two');
  });
});
