// The wiring, not the parts: a real `remy run` puts the stored place in the first message the model
// sees, and says nothing about a place when none is stored or the person turned it off.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelClient, ModelRequest } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { openLocation } from './location.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-location-wiring-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

async function firstMessage(): Promise<string> {
  const seen: string[] = [];
  const inner = new ScriptedModelClient([
    {
      calls: [{ tool: 'finish', args: { answer: 'Done.' } }],
      usage: { inTokens: 1, outTokens: 1 },
    },
  ]);
  const model: ModelClient = {
    id: inner.id,
    caps: inner.caps,
    complete: (req: ModelRequest, ...a) => {
      seen.push(req.messages.map((m) => m.content).join('\n'));
      return inner.complete(req, ...a);
    },
  };
  const deps: CliDeps = {
    env: { REMY_HOME: home, REMY_KEYCHAIN: 'off' },
    cwd: home,
    out: () => {},
    err: () => {},
    isTTY: false,
    store: new MemoryEventStore(),
    model,
  };
  expect(await cli(['run', 'ramen nearby'], deps)).toBe(0);
  return seen[0] ?? '';
}

describe('the situation block in a real run', () => {
  it('names the stored place, approximately and with when it was set', async () => {
    openLocation(home).set({
      place: 'Philadelphia, Pennsylvania, US',
      lat: 39.95,
      lon: -75.16,
      setAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    expect(await firstMessage()).toContain(
      '- Where the person is: Philadelphia, Pennsylvania, US (approximate, set 2 days ago).',
    );
  });

  it('says nothing about a place when none is stored, or after it was turned off', async () => {
    expect(await firstMessage()).not.toContain('Where the person is');
    openLocation(home).set({ place: 'Camden', lat: 1, lon: 1, setAt: new Date().toISOString() });
    openLocation(home).turnOff();
    const msg = await firstMessage();
    expect(msg).not.toContain('Where the person is');
    expect(msg).not.toContain('Camden');
  });
});
