import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelRequest, ModelResponse } from '@remy/core';
import { describe, expect, it } from 'vitest';
import {
  loadCassette,
  RecordingModelClient,
  ReplayModelClient,
  ScriptedModelClient,
  saveCassette,
} from './doubles.ts';

const sig = new AbortController().signal;
const usage = { inTokens: 1, outTokens: 1 };
const res = (text: string): ModelResponse => ({ text, calls: [], usage });
const req = (content: string): ModelRequest => ({
  system: 's',
  messages: [{ role: 'user', content }],
  tools: [],
  maxOutputTokens: 10,
  temperature: 0,
});

describe('ScriptedModelClient', () => {
  it('plays responses, errors and functions in order, records requests, then throws', async () => {
    const c = new ScriptedModelClient([
      res('a'),
      new Error('boom'),
      (r) => res(`echo ${r.messages.length}`),
    ]);
    expect((await c.complete(req('1'), sig)).text).toBe('a');
    await expect(c.complete(req('2'), sig)).rejects.toThrow('boom');
    expect((await c.complete(req('3'), sig)).text).toBe('echo 1');
    expect(c.requests).toHaveLength(3);
    await expect(c.complete(req('4'), sig)).rejects.toThrow(/exhausted/);
  });
});

describe('record / replay', () => {
  it('records, persists as JSON, and replays by request hash', async () => {
    const cassette = new Map<string, ModelResponse>();
    const rec = new RecordingModelClient(
      new ScriptedModelClient([res('one'), res('two')]),
      cassette,
    );
    await rec.complete(req('q1'), sig);
    await rec.complete(req('q2'), sig);
    expect(cassette.size).toBe(2);

    const path = join(mkdtempSync(join(tmpdir(), 'remy-')), 'c.json');
    saveCassette(path, cassette);
    const replay = new ReplayModelClient(loadCassette(path));
    expect((await replay.complete(req('q2'), sig)).text).toBe('two');
    expect((await replay.complete(req('q1'), sig)).text).toBe('one');
  });

  it('throws a clear error on a miss', async () => {
    await expect(new ReplayModelClient(new Map()).complete(req('x'), sig)).rejects.toThrow(
      /no recorded response/,
    );
  });
});
