// What `remy run` prints when the model fails: plain words and the next step, never the provider's raw body.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelError } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-runfail-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

async function run(errors: Error[]) {
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home },
    cwd: home,
    out: (s) => {
      o.out += `${s}\n`;
    },
    err: (s) => {
      o.err += `${s}\n`;
    },
    isTTY: false,
    store: new MemoryEventStore(),
    model: new ScriptedModelClient(errors),
    sleep: async () => {},
  };
  const code = await cli(['run', 'write a file'], deps);
  return { code, out: o.out, err: o.err };
}

const bad = (body: string) => new ModelError(`HTTP 401: ${body}`, false);

describe('remy run when the model fails', () => {
  it('a wrong key says so and names remy login, with no raw body', async () => {
    const r = await run([bad('{"error":{"message":"Incorrect API key provided: sk-abc"}}')]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Failed: The key was rejected. Run remy login to replace it.');
    expect(r.out).not.toMatch(/[{}]|HTTP 401|sk-abc/);
  });

  it('a model that does not exist says to pick another', async () => {
    const r = await run([
      new ModelError('HTTP 404: {"error":{"message":"The model `nope` does not exist"}}', false),
    ]);
    expect(r.out).toContain('Failed: This key cannot use that model.');
    expect(r.out).not.toMatch(/[{}]|HTTP 404/);
  });

  it('retries show as one calm line each, not the raw error', async () => {
    const r = await run(
      Array.from({ length: 5 }, () => new ModelError('the model returned an empty reply', true)),
    );
    expect(r.out).toContain('The model did not answer (attempt 1)');
    expect(r.out).not.toContain('model failed (attempt');
    expect(r.out).toContain('Failed: The model sent back an empty reply each time.');
  });

  it('a network that stays down pauses the task and says how to carry on', async () => {
    const down = () => new ModelError('network error: fetch failed', true, { unreachable: true });
    const r = await run(Array.from({ length: 5 }, down));
    expect(r.code).toBe(1);
    expect(r.out).toContain('Remy lost contact with the model');
    expect(r.out).toMatch(/Continue: .*remy continue task_[0-9a-f]{12}/);
    expect(r.out).not.toMatch(/fetch failed|Failed:/);
  });
});
