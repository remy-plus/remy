// --debug: model requests, model responses and runtime events as JSON lines.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ModelClient, ModelRequest, ModelResponse } from '@remy/core';

export interface DebugLog {
  /** Where the lines go: a file path, or "stderr". */
  target: string;
  write(kind: string, data: unknown): void;
}

export interface DebugOptions {
  /** `--debug` */
  flag: boolean;
  /** REMY_DEBUG: 1 or true turns it on; any other value except 0 is the file to write. */
  env: string | undefined;
  home: string;
  cwd: string;
  /** In the chat the screen owns stderr, so lines go to a file by default. */
  chat: boolean;
  stderr: (text: string) => void;
  redact: (text: string) => string;
  now?: () => Date;
}

export function openDebug(o: DebugOptions): DebugLog | undefined {
  const env = o.env?.trim();
  const named = env && !['0', '1', 'true', 'false'].includes(env.toLowerCase()) ? env : undefined;
  const on = o.flag || named !== undefined || env === '1' || env?.toLowerCase() === 'true';
  if (!on) return undefined;
  const at = o.now ?? (() => new Date());
  const emit = (line: string, sink: (text: string) => void) => sink(`${o.redact(line)}\n`);

  let file: string | undefined;
  if (named) file = resolve(o.cwd, named);
  else if (o.chat) file = join(o.home, `debug-${at().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    const path = file;
    return {
      target: path,
      write: (kind, data) =>
        emit(JSON.stringify({ at: at().toISOString(), kind, ...asObject(data) }), (t) =>
          appendFileSync(path, t),
        ),
    };
  }
  return {
    target: 'stderr',
    write: (kind, data) =>
      emit(JSON.stringify({ at: at().toISOString(), kind, ...asObject(data) }), o.stderr),
  };
}

const asObject = (data: unknown): Record<string, unknown> =>
  data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : { data };

/** Logs each model request and its response (or error), then passes them through unchanged. */
export function debugModel(inner: ModelClient, log: DebugLog): ModelClient {
  return {
    id: inner.id,
    caps: inner.caps,
    async complete(req: ModelRequest, signal: AbortSignal, onText): Promise<ModelResponse> {
      const t0 = Date.now();
      log.write('model.request', { model: inner.id, request: req });
      try {
        const response = await inner.complete(req, signal, onText);
        log.write('model.response', { latencyMs: Date.now() - t0, response });
        return response;
      } catch (e) {
        log.write('model.error', {
          latencyMs: Date.now() - t0,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
  };
}
