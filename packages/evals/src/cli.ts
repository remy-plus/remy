// `pnpm eval` entry point. evalMain(argv) returns the process exit code.
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { ModelClient } from '@remy/core';
import {
  type Cassette,
  loadCassette,
  modelFromEnv,
  RecordingModelClient,
  ReplayModelClient,
  saveCassette,
} from '@remy/models';
import { CASES } from './cases/index.ts';
import { compare, renderCompare } from './compare.ts';
import { referenceModel } from './reference.ts';
import { fileSafe, readResults, renderSummary, writeResults } from './report.ts';
import { runEval } from './runner.ts';
import { type ModelFor, SUITES, type Suite } from './types.ts';

const USAGE = `Usage:
  eval [run] [--model <id|reference>] [--profile <name>] [--suite <a,b>] [--case <id,...>]
             [--k <n>] [--record] [--replay <cassette>] [--out <dir>] [--strict] [--no-write]
  eval compare <base.json> <next.json>

Models: "reference" plays each case's ideal plan (deterministic, free). Anything else is a live
model id sent through REMY_PROFILE / REMY_BASE_URL / REMY_API_KEY, or --profile.`;

const list = (s: string | undefined) => (s ? s.split(',').map((x) => x.trim()) : []);

function compareMain(base: string | undefined, next: string | undefined): number {
  if (!base || !next) {
    console.error(USAGE);
    return 2;
  }
  const b = readResults(base);
  const n = readResults(next);
  const regressions = compare(b, n);
  process.stdout.write(renderCompare(b, n, regressions));
  return regressions.length ? 1 : 0;
}

export async function evalMain(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [cmd, ...rest] = positionals[0] === 'run' ? positionals.slice(1) : positionals;
  if (cmd === 'compare') return compareMain(rest[0], rest[1]);
  if (cmd !== undefined) {
    console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
    return 2;
  }

  const suites = list(values.suite) as Suite[];
  const bad = suites.find((s) => !SUITES.includes(s));
  if (bad) {
    console.error(`Unknown suite "${bad}". Suites: ${SUITES.join(', ')}`);
    return 2;
  }
  const k = Number(values.k ?? 1);
  if (!Number.isInteger(k) || k < 1) {
    console.error('--k must be a positive integer');
    return 2;
  }

  const outDir = values.out ?? 'evals/results';
  const cassetteDir = values.cassettes ?? 'evals/cassettes';
  const modelId = values.model ?? process.env.REMY_MODEL ?? 'reference';
  let live: ModelClient | undefined;
  let cassette: Cassette | undefined;

  try {
    if (values.replay) {
      live = new ReplayModelClient(loadCassette(values.replay), {
        id: basename(values.replay).replace(/\.json$/, ''),
      });
    } else if (modelId !== 'reference') {
      const env = {
        ...process.env,
        REMY_MODEL: modelId,
        ...(values.profile && { REMY_PROFILE: values.profile }),
      };
      live = modelFromEnv(env);
      if (values.record) {
        cassette = new Map();
        live = new RecordingModelClient(live, cassette);
      }
    }
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const client = live;
  const modelFor: ModelFor = client ? () => client : (c) => referenceModel(c.reference);

  const result = await runEval(CASES, modelFor, {
    k,
    suites,
    caseIds: list(values.case),
    onRun: (r) =>
      console.log(
        `${r.pass ? 'pass' : 'FAIL'}  ${r.caseId}${k > 1 ? ` #${r.run + 1}` : ''}  ${r.steps} steps, ${r.wallMs}ms`,
      ),
  });
  if (result.runs.length === 0) {
    console.error('No cases matched.');
    return 2;
  }

  if (cassette && client) {
    mkdirSync(cassetteDir, { recursive: true });
    const path = join(cassetteDir, `${fileSafe(modelId)}.json`);
    saveCassette(path, cassette);
    console.log(`Cassette: ${path}`);
  }
  console.log(`\n${renderSummary(result)}`);
  if (!values['no-write']) console.log(`Results: ${writeResults(result, outDir)}`);

  const m = result.metrics.overall;
  if (m.safetyViolations > 0 || m.duplicateEffects > 0) {
    console.error(
      `${m.safetyViolations} safety violation(s), ${m.duplicateEffects} duplicate side effect(s). Both must be 0.`,
    );
    return 1;
  }
  if (values.strict && m.successRate < 1) {
    console.error(`${result.runs.filter((r) => !r.pass).length} run(s) failed.`);
    return 1;
  }
  return 0;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      profile: { type: 'string' },
      suite: { type: 'string' },
      case: { type: 'string' },
      k: { type: 'string' },
      record: { type: 'boolean' },
      replay: { type: 'string' },
      out: { type: 'string' },
      cassettes: { type: 'string' },
      strict: { type: 'boolean' },
      'no-write': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await evalMain(process.argv.slice(2));
}
