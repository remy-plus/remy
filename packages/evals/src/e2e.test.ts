import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingModelClient, ReplayModelClient } from '@remy/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CASES } from './cases/index.ts';
import { evalMain } from './cli.ts';
import { compare } from './compare.ts';
import { referenceModel } from './reference.ts';
import { type EvalResult, runCase, runEval } from './runner.ts';
import { SUITES } from './types.ts';

const byRef = (c: (typeof CASES)[number]) => referenceModel(c.reference);

/** Strips wall-clock noise so two runs can be compared exactly. */
const stable = (r: EvalResult) =>
  JSON.stringify({
    runs: r.runs.map(({ wallMs: _w, modelLatencyMs: _m, ...rest }) => rest),
    overall: { ...r.metrics.overall, wallP50: 0, wallP95: 0, modelLatencyMs: 0 },
  });

afterEach(() => vi.restoreAllMocks());

describe('the starting cases', () => {
  it('follow the PLAN.md distribution', () => {
    const count = (s: string) => CASES.filter((c) => c.suite === s).length;
    expect(SUITES.map(count)).toEqual([12, 8, 6, 6, 4]);
    expect(CASES).toHaveLength(36);
  });

  it('pass on the reference model with no safety or duplicate failures, deterministically', async () => {
    const a = await runEval(CASES, byRef);
    const b = await runEval(CASES, byRef);
    const failed = a.runs.filter((r) => !r.pass).map((r) => r.caseId);
    expect(failed).toEqual([]);
    expect(a.metrics.overall).toMatchObject({
      cases: 36,
      successRate: 1,
      passK: 1,
      safetyViolations: 0,
      duplicateEffects: 0,
    });
    expect(stable(a)).toBe(stable(b));
  });

  it('really inject their faults', async () => {
    const r = await runEval(
      CASES.filter((c) => c.faults),
      byRef,
    );
    const crashes = Object.fromEntries(r.runs.map((x) => [x.caseId, x.crashes]));
    expect(crashes).toEqual({
      'recovery-crash-in-email-send': 1,
      'recovery-crash-after-model-response': 1,
      'recovery-transient-fetch': 0,
      'recovery-crash-in-write-file': 1,
    });
  });

  it('keep a gullible model from acting on injected instructions', async () => {
    for (const c of CASES.filter((x) => x.attack)) {
      const [first, ...rest] = c.reference;
      if (!first || !c.attack) throw new Error(c.id);
      const gullible = { ...c, reference: [first, c.attack, ...rest] };
      const r = await runCase(gullible, referenceModel(gullible.reference));
      const attack = r.toolCalls.find((t) => t.outcome === 'declined');
      expect(attack, c.id).toBeDefined();
      expect(r, c.id).toMatchObject({ pass: true, safetyViolations: 0, policyViolations: [] });
    }
  });

  it('replays a recorded cassette to the same results', async () => {
    const cassette = new Map();
    const recorded = await runEval(CASES, (c) => new RecordingModelClient(byRef(c), cassette));
    const replayed = await runEval(
      CASES,
      () => new ReplayModelClient(cassette, { id: 'reference', caps: referenceModel([]).caps }),
    );
    expect(stable(replayed)).toBe(stable(recorded));
  });

  it('compare flags a seeded regression', async () => {
    const base = await runEval(CASES, byRef);
    const worse = await runEval(CASES, (c) =>
      referenceModel(
        c.suite === 'research' ? [...c.reference.slice(0, -1), 'No idea.'] : c.reference,
      ),
    );
    expect(compare(base, base)).toEqual([]);
    expect(compare(base, worse).map((r) => r.kind)).toEqual(['success']);
  });
});

describe('evalMain', () => {
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  };

  it('runs a suite and writes results', async () => {
    quiet();
    const out = mkdtempSync(join(tmpdir(), 'remy-evals-out-'));
    expect(
      await evalMain(['--model', 'reference', '--suite', 'recovery', '--strict', '--out', out]),
    ).toBe(0);
  });

  it('exits non-zero from compare when a regression is seeded', async () => {
    quiet();
    const dir = mkdtempSync(join(tmpdir(), 'remy-evals-cmp-'));
    const base = await runEval(CASES, byRef, { suites: ['research'] });
    const worse = JSON.parse(JSON.stringify(base)) as EvalResult;
    worse.runs[0] = { ...worse.runs[0], safetyViolations: 1 } as never;
    worse.metrics.suites.research = {
      ...worse.metrics.suites.research,
      safetyViolations: 1,
    } as never;
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, JSON.stringify(base));
    writeFileSync(b, JSON.stringify(worse));
    expect(await evalMain(['compare', a, a])).toBe(0);
    expect(await evalMain(['compare', a, b])).toBe(1);
  });

  it('rejects bad arguments', async () => {
    quiet();
    expect(await evalMain(['--suite', 'nope'])).toBe(2);
    expect(await evalMain(['--k', '0'])).toBe(2);
    expect(await evalMain(['--bogus'])).toBe(2);
    expect(await evalMain(['--case', 'missing'])).toBe(2);
    expect(await evalMain(['compare'])).toBe(2);
  });
});
