import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRuntime,
  DEFAULT_BUDGET,
  type LiveEvent,
  type ModelClient,
  type ModelResponse,
  ToolRegistry,
} from '@remy/core';
import { DEFAULT_CAPS } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { finish } from '@remy/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { listenServe, type ServeListening } from './serve.ts';
import { createLiveBus, liveWriter } from './serve-live.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createLiveBus', () => {
  it('delivers pieces to the task’s subscribers only, until they leave', () => {
    const bus = createLiveBus();
    const a: LiveEvent[] = [];
    const b: LiveEvent[] = [];
    const offA = bus.subscribe('t1', (e) => a.push(e));
    bus.subscribe('t2', (e) => b.push(e));
    bus.publish('t1', { kind: 'start' });
    bus.publish('t1', { kind: 'answer', delta: 'Hi' });
    offA();
    bus.publish('t1', { kind: 'answer', delta: ' there' });
    expect(a).toEqual([{ kind: 'start' }, { kind: 'answer', delta: 'Hi' }]);
    expect(b).toEqual([]);
  });

  it('replays what is written so far to a late subscriber, and forgets at a new call', () => {
    const bus = createLiveBus();
    bus.publish('t', { kind: 'answer', delta: 'Wel' });
    bus.publish('t', { kind: 'answer', delta: 'come' });
    const late: LiveEvent[] = [];
    bus.subscribe('t', (e) => late.push(e));
    expect(late).toEqual([{ kind: 'answer', delta: 'Welcome' }]);
    bus.publish('t', { kind: 'start' });
    const later: LiveEvent[] = [];
    bus.subscribe('t', (e) => later.push(e));
    expect(later).toEqual([]);
    bus.publish('t', { kind: 'text', delta: 'x' });
    bus.clear('t');
    const after: LiveEvent[] = [];
    bus.subscribe('t', (e) => after.push(e));
    expect(after).toEqual([]);
  });

  it('keeps going when one subscriber throws', () => {
    const bus = createLiveBus();
    const got: LiveEvent[] = [];
    bus.subscribe('t', () => {
      throw new Error('closed');
    });
    bus.subscribe('t', (e) => got.push(e));
    bus.publish('t', { kind: 'text', delta: 'ok' });
    expect(got).toHaveLength(1);
  });
});

describe('liveWriter', () => {
  const run = (redact: (s: string) => string, events: LiveEvent[]) => {
    const out: unknown[] = [];
    const w = liveWriter(redact, (m) => out.push(m.live));
    for (const e of events) w(e);
    return out;
  };

  it('sends deltas as they are', () => {
    expect(
      run(
        (s) => s,
        [{ kind: 'start' }, { kind: 'answer', delta: 'Hel' }, { kind: 'answer', delta: 'lo' }],
      ),
    ).toEqual([
      { kind: 'start' },
      { kind: 'answer', delta: 'Hel' },
      { kind: 'answer', delta: 'lo' },
    ]);
  });

  it('replaces the text when a secret turns out to have been split across pieces', () => {
    const redact = (s: string) => s.replaceAll('sk-12345', '[hidden]');
    const out = run(redact, [
      { kind: 'answer', delta: 'key sk-12' },
      { kind: 'answer', delta: '345 ok' },
    ]);
    expect(out).toEqual([
      { kind: 'answer', delta: 'key sk-12' },
      { kind: 'set', of: 'answer', text: 'key [hidden] ok' },
    ]);
  });

  it('starts over at each model call', () => {
    const out = run(
      (s) => s,
      [{ kind: 'answer', delta: 'one' }, { kind: 'start' }, { kind: 'answer', delta: 'two' }],
    );
    expect(out).toEqual([
      { kind: 'answer', delta: 'one' },
      { kind: 'start' },
      { kind: 'answer', delta: 'two' },
    ]);
  });
});

describe('the event stream carries words on their way', () => {
  let serving: ServeListening | undefined;
  let home: string | undefined;
  afterEach(async () => {
    await serving?.close();
    if (home) rmSync(home, { recursive: true, force: true });
    serving = undefined;
  });

  /** A model that writes its answer in pieces, `gap` ms apart. */
  const slowModel = (pieces: string[], gap: number): ModelClient => ({
    id: 'slow',
    caps: DEFAULT_CAPS,
    async complete(_req, _sig, _text, _reason, onAnswer): Promise<ModelResponse> {
      for (const p of pieces) {
        await wait(gap);
        onAnswer?.(p);
      }
      return {
        calls: [{ tool: 'finish', args: { answer: pieces.join('') } }],
        usage: { inTokens: 1, outTokens: 1 },
      };
    },
  });

  async function start(model: ModelClient) {
    home = mkdtempSync(join(tmpdir(), 'remy-live-'));
    const token = makeServeToken(home);
    const store = new MemoryEventStore();
    const live = createLiveBus();
    const runtime = createRuntime({
      store,
      model,
      tools: new ToolRegistry([finish]),
      capabilities: () => ({}) as never,
      sleep: async () => {},
      onLive: (id, e) => live.publish(id, e),
    });
    serving = await listenServe(
      {
        store,
        runtime,
        live,
        home,
        version: '9.9.9',
        redact: (s) => s.replaceAll('SECRET', '[hidden]'),
        config: () => ({
          model: 'slow',
          permissions: { autoApprove: ['read'] },
          budget: DEFAULT_BUDGET,
          workspaceDir: '/w',
        }),
        tokenHash: () => serveTokenHash(home as string),
        lockout: { blocked: () => false, fail: () => {} },
        log: () => {},
        pollMs: 20,
        busyMs: 50,
        mounts: [],
      },
      { host: '127.0.0.1', port: 0 },
    );
    const base = `http://127.0.0.1:${serving.port}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const res = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'hi' }),
    });
    const { taskId } = (await res.json()) as { taskId: string };
    return { base, headers, taskId };
  }

  /** Reads a stream to its end, noting when each data block arrived. */
  async function read(url: string, headers: Record<string, string>) {
    const res = await fetch(url, { headers });
    const t0 = Date.now();
    const blocks: { at: number; raw: string }[] = [];
    let buf = '';
    const dec = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        blocks.push({ at: Date.now() - t0, raw: buf.slice(0, i) });
        buf = buf.slice(i + 2);
      }
    }
    return blocks.map((b) => b.raw);
  }

  it('sends the answer in pieces, without ids, before the stored answer', async () => {
    const { base, headers, taskId } = await start(slowModel(['The ', 'sun ', 'is out.'], 60));
    const blocks = await read(`${base}/api/tasks/${taskId}/stream`, headers);
    const live = blocks.filter((b) => b.startsWith('data: {"live"'));
    const msgs = live.map((b) => JSON.parse(b.slice(6)).live);
    expect(msgs.filter((m) => m.kind === 'answer').map((m) => m.delta)).toEqual([
      'The ',
      'sun ',
      'is out.',
    ]);
    // Live blocks carry no id, so Last-Event-ID only ever counts stored events.
    for (const b of live) expect(b).not.toContain('\nid:');
    // The stored events are all there, and the final answer comes from them.
    const stored = blocks
      .filter((b) => b.includes('id: '))
      .map((b) => JSON.parse(b.split('data: ')[1] ?? ''));
    const finished = stored.find((e) => e.event.type === 'task.finished');
    expect(finished.event.answer).toBe('The sun is out.');
    // The first live piece arrives before the task's own events end.
    const firstLive = blocks.findIndex((b) => b.startsWith('data: {"live"'));
    const lastStored = blocks.findLastIndex((b) => b.includes('task.finished'));
    expect(firstLive).toBeLessThan(lastStored);
  });

  it('never stores a piece', async () => {
    const { base, headers, taskId } = await start(slowModel(['abc'], 10));
    await read(`${base}/api/tasks/${taskId}/stream`, headers);
    const again = await read(`${base}/api/tasks/${taskId}/stream?lastEventId=0`, headers);
    expect(again.some((b) => b.includes('"live"'))).toBe(false);
  });

  it('hides a secret in a streamed answer', async () => {
    const { base, headers, taskId } = await start(slowModel(['key SEC', 'RET end'], 30));
    const blocks = await read(`${base}/api/tasks/${taskId}/stream`, headers);
    const all = blocks.join('\n');
    expect(all).not.toContain('SECRET');
    expect(all).toContain('[hidden]');
  });

  it('gives a screen that connects mid-sentence what is written so far', async () => {
    const { base, headers, taskId } = await start(
      slowModel(['one ', 'two ', 'three ', 'four'], 120),
    );
    await wait(200); // after "one " has been written
    const blocks = await read(`${base}/api/tasks/${taskId}/stream`, headers);
    const msgs = blocks
      .filter((b) => b.startsWith('data: {"live"'))
      .map((b) => JSON.parse(b.slice(6)).live);
    const text = msgs
      .filter((m) => m.kind === 'answer')
      .map((m) => m.delta)
      .join('');
    expect(text).toBe('one two three four');
  });
});
