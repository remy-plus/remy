import { readFileSync, writeFileSync } from 'node:fs';
import {
  argsHash,
  type ModelCaps,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from '@remy/core';
import { DEFAULT_CAPS } from './catalog.ts';

export type Cassette = Map<string, ModelResponse>;

export type ScriptStep = ModelResponse | Error | ((req: ModelRequest) => ModelResponse);

export class ScriptedModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly id: string;
  readonly caps: ModelCaps;
  #steps: ScriptStep[];

  constructor(steps: ScriptStep[], opts: { id?: string; caps?: ModelCaps } = {}) {
    this.#steps = [...steps];
    this.id = opts.id ?? 'scripted';
    this.caps = opts.caps ?? DEFAULT_CAPS;
  }

  async complete(
    req: ModelRequest,
    _signal?: AbortSignal,
    onText?: (delta: string) => void,
  ): Promise<ModelResponse> {
    this.requests.push(req);
    const step = this.#steps.shift();
    if (step === undefined)
      throw new Error(
        `ScriptedModelClient exhausted: request #${this.requests.length} had no step`,
      );
    if (step instanceof Error) throw step;
    const res = typeof step === 'function' ? step(req) : step;
    if (res.text) onText?.(res.text);
    return res;
  }
}

export class RecordingModelClient implements ModelClient {
  readonly id: string;
  readonly caps: ModelCaps;
  readonly #inner: ModelClient;
  readonly cassette: Cassette;

  constructor(inner: ModelClient, cassette: Cassette) {
    this.#inner = inner;
    this.cassette = cassette;
    this.id = inner.id;
    this.caps = inner.caps;
  }

  async complete(
    req: ModelRequest,
    signal: AbortSignal,
    onText?: (delta: string) => void,
    onReasoning?: (delta: string) => void,
  ): Promise<ModelResponse> {
    const res = await this.#inner.complete(req, signal, onText, onReasoning);
    this.cassette.set(argsHash(req), res);
    return res;
  }
}

export class ReplayModelClient implements ModelClient {
  readonly cassette: Cassette;
  readonly id: string;
  readonly caps: ModelCaps;

  constructor(cassette: Cassette, opts: { id?: string; caps?: ModelCaps } = {}) {
    this.cassette = cassette;
    this.id = opts.id ?? 'replay';
    this.caps = opts.caps ?? DEFAULT_CAPS;
  }

  async complete(
    req: ModelRequest,
    _signal?: AbortSignal,
    onText?: (delta: string) => void,
  ): Promise<ModelResponse> {
    const hit = this.cassette.get(argsHash(req));
    if (!hit)
      throw new Error(
        `ReplayModelClient: no recorded response for request ${argsHash(req)} (re-record the cassette)`,
      );
    if (hit.text) onText?.(hit.text);
    return hit;
  }
}

export function saveCassette(path: string, map: Cassette): void {
  const sorted = Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

export function loadCassette(path: string): Cassette {
  return new Map(
    Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, ModelResponse>),
  );
}
