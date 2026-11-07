import type { ModelClient } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { referenceModel } from '../reference.ts';
import { choiceTable, expectedChoice } from '../report.ts';
import { runCase, runEval } from '../runner.ts';
import { choice } from './choice.ts';

/** Plays the reference and keeps the names of the tools the first request offered. */
function watching(c: (typeof choice)[number]) {
  const inner = referenceModel(c.reference);
  let offered: string[] = [];
  let calls = 0;
  const model: ModelClient = {
    id: inner.id,
    caps: inner.caps,
    complete(req, signal) {
      calls += 1;
      if (!offered.length) offered = req.tools.map((t) => t.name);
      return inner.complete(req, signal);
    },
  };
  return { model, offered: () => offered, calls: () => calls };
}

describe('choice suite', () => {
  it('has distinct prompts and only first-reply cases', () => {
    expect(new Set(choice.map((c) => c.prompt)).size).toBe(choice.length);
    expect(choice.every((c) => c.firstReplyOnly && c.suite === 'choice')).toBe(true);
    expect(choice.length).toBeGreaterThanOrEqual(30);
  });

  for (const c of choice) {
    it(`offers what ${c.id} should pick`, async () => {
      const w = watching(c);
      const r = await runCase(c, w.model);
      // However the run ends, the model behind it is asked once.
      expect(w.calls()).toBe(1);
      const first = r.firstReply?.calls.map((x) => x.tool) ?? [];
      // The reference's own pick must be on offer, or the case could never pass live.
      for (const t of first) expect(w.offered()).toContain(t);
      const nots = c.graders.flatMap((g) => /not ([^)]+)\)/.exec(g.name)?.[1]?.split('|') ?? []);
      // And so must what it should not pick, or avoiding it proves nothing.
      for (const t of nots) expect(w.offered(), `${t} offered`).toContain(t);
    });
  }

  it('lists each skill a skill case needs', () => {
    for (const c of choice.filter((x) => x.graders[0]?.name.startsWith('choseSkill'))) {
      const name = /\((.+)\)/.exec(c.graders[0]?.name ?? '')?.[1];
      expect(c.world.skills?.map((s) => s.name)).toContain(name);
    }
  });
});

describe('choice report', () => {
  // Always searches, whatever was asked.
  const searcher = () => referenceModel([[{ tool: 'web_search', args: { query: 'x' } }]]);

  it('reads the expected pick from the grader and scores per pick', async () => {
    const res = await runEval(choice, () => searcher());
    const picks = new Set(res.runs.map(expectedChoice));
    expect(picks.has('calculate')).toBe(true);
    expect(picks.has('use_skill:research')).toBe(true);
    expect(picks.has('none')).toBe(true);
    const text = choiceTable(res.runs).join('\n');
    expect(text).toContain('| calculate | 3 | 0% (0/3) |');
    expect(text).toMatch(/\| web_search \| \d+ \| 100% /);
  });

  it('prints nothing for other suites', () => {
    expect(choiceTable([])).toEqual([]);
  });
});
