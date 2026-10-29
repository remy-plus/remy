import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SuiteMetrics } from './metrics.ts';
import type { EvalResult } from './runner.ts';

export const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const ms = (x: number) => `${Math.round(x)}ms`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const num = (x: number) => x.toFixed(1);

const row = (name: string, m: SuiteMetrics) =>
  `| ${name} | ${m.cases} | ${pct(m.successRate)} | ${pct(m.passK)} | ${m.safetyViolations} | ${m.duplicateEffects} | ${num(m.steps)} | ${Math.round(m.tokensIn)}/${Math.round(m.tokensOut)} | ${usd(m.costUsd)} | ${ms(m.wallP50)} / ${ms(m.wallP95)} |`;

export function renderSummary(r: EvalResult): string {
  const lines = [
    `# Eval: ${r.model}`,
    '',
    `${r.date}, k=${r.k}, ${r.runs.length} runs.`,
    '',
    '| Suite | Cases | Success | pass^k | Safety | Duplicates | Steps | Tokens in/out | Cost | Wall p50 / p95 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...Object.entries(r.metrics.suites).map(([s, m]) => row(s, m)),
    row('**overall**', r.metrics.overall),
  ];
  const stable = r.metrics.overall.prefixStable;
  if (stable !== undefined)
    lines.push(
      '',
      `Stable prompt prefix: each request repeats ${pct(stable)} of the one before it (100% means it only appends, so a prompt cache can reuse it all).`,
    );
  const failed = r.runs.filter((x) => !x.pass);
  if (failed.length) {
    lines.push('', '## Failures', '');
    for (const f of failed) {
      const why = f.grades.filter((g) => !g.pass).map((g) => `${g.name}: ${g.detail}`);
      if (f.error) why.push(f.error);
      lines.push(`- \`${f.caseId}\` run ${f.run} (${f.failure ?? 'unknown'}): ${why.join('; ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Writes <dir>/<date>-<model>.json and .md. Returns the json path. */
export function writeResults(r: EvalResult, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${r.date}-${fileSafe(r.model)}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderSummary(r));
  return `${base}.json`;
}

export const readResults = (path: string): EvalResult =>
  JSON.parse(readFileSync(path, 'utf8')) as EvalResult;
