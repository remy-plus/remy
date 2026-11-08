// Optional embeddings for recall (REMY_EMBEDDINGS=on, off by default). When on, the text of each
// saved note goes to the /embeddings endpoint of the provider the user already chose for chat, and
// nowhere else: the endpoint is worked out from the same login as the chat model, there is no
// separate address to set. Only note text and the recall query are sent, never task content,
// files or keys. A note's vector is stored in the note_vectors table next to the note, made once
// per note and again when the note is edited, and requested in batches. If the endpoint fails
// (not offered, refused, offline, malformed), ranking stays local for the rest of the process and
// `remy doctor` says so. With personalising off, nothing is sent at all.
//
// This lives in the CLI, behind the SemanticSource port from @remy/tools, rather than as an `embed`
// on ModelClient: the chat client hides its address and key on purpose, and embeddings need both,
// so putting them on the client would push provider specifics into core.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MemoryEntry, Semantic, SemanticSource } from '@remy/tools';

/** Where to send the text: the chat provider's address and key, and the embedding model. */
export interface EmbedEndpoint {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface StoredVector {
  hash: string;
  vec: number[];
}

/** The slice of the note store the embedder needs. */
export interface VectorStore {
  vectors(space: string): Map<string, StoredVector>;
  saveVectors(space: string, rows: { id: string; hash: string; vec: number[] }[]): void;
}

/** Notes sent in one request. */
export const EMBED_BATCH = 64;
const TIMEOUT_MS = 10_000;

/** Vectors are only comparable inside one provider and model, so rows are keyed by both. */
export const spaceOf = (e: EmbedEndpoint): string => `${e.baseUrl.replace(/\/+$/, '')}|${e.model}`;

export const hashText = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 24);

/** The model to use: `REMY_EMBEDDING_MODEL`, else OpenAI's small one when the provider is OpenAI. */
export function embeddingModel(
  env: Record<string, string | undefined>,
  baseUrl: string,
): string | undefined {
  if (env.REMY_EMBEDDING_MODEL) return env.REMY_EMBEDDING_MODEL;
  return /^https:\/\/api\.openai\.com\//.test(baseUrl) ? 'text-embedding-3-small' : undefined;
}

export class EmbedError extends Error {}

/** One request to the OpenAI-compatible /embeddings endpoint. */
export async function embedTexts(
  e: EmbedEndpoint,
  texts: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetchImpl(`${e.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(e.apiKey && { authorization: `Bearer ${e.apiKey}` }),
      },
      body: JSON.stringify({ model: e.model, input: texts }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new EmbedError(`could not reach the endpoint (${(err as Error).message})`);
  }
  if (!res.ok) throw new EmbedError(`the endpoint answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new EmbedError('the endpoint did not answer with JSON');
  }
  const data = (body as { data?: { index?: number; embedding?: unknown }[] }).data;
  if (!Array.isArray(data) || data.length !== texts.length)
    throw new EmbedError('the endpoint returned the wrong number of vectors');
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((d) => {
    if (!Array.isArray(d.embedding) || !d.embedding.every((x) => typeof x === 'number'))
      throw new EmbedError('the endpoint returned a vector in an unknown shape');
    return d.embedding as number[];
  });
}

export interface NoteEmbedderOptions {
  /** REMY_EMBEDDINGS=on. */
  on: boolean;
  /** Read on every call: personalising can be switched off mid-session. */
  personalising: () => boolean;
  store: VectorStore;
  /** The user's provider; undefined when it cannot be worked out or no embedding model is known. */
  endpoint: () => EmbedEndpoint | undefined;
  fetch?: typeof fetch;
  /** Where to record a failure for `remy doctor`. */
  statusFile?: string;
}

export interface EmbeddingStatus {
  state: 'off' | 'on' | 'failed' | 'unavailable';
  detail?: string;
}

export function createNoteEmbedder(o: NoteEmbedderOptions): {
  source: SemanticSource;
  failure: () => string | undefined;
} {
  let failed: string | undefined;
  const queries = new Map<string, number[]>();
  const fail = (why: string) => {
    failed = why;
    if (o.statusFile) {
      try {
        mkdirSync(dirname(o.statusFile), { recursive: true });
        writeFileSync(o.statusFile, JSON.stringify({ at: new Date().toISOString(), detail: why }), {
          mode: 0o600,
        });
      } catch {}
    }
  };
  const source = async (notes: MemoryEntry[], query: string): Promise<Semantic | undefined> => {
    if (!o.on || failed || !o.personalising() || !notes.length) return undefined;
    const endpoint = o.endpoint();
    if (!endpoint) return undefined;
    const space = spaceOf(endpoint);
    try {
      const have = o.store.vectors(space);
      const missing = notes.filter((n) => have.get(n.id)?.hash !== hashText(n.text));
      for (let i = 0; i < missing.length; i += EMBED_BATCH) {
        const chunk = missing.slice(i, i + EMBED_BATCH);
        const vecs = await embedTexts(
          endpoint,
          chunk.map((n) => n.text),
          o.fetch,
        );
        const rows = chunk.map((n, j) => ({
          id: n.id,
          hash: hashText(n.text),
          vec: vecs[j] as number[],
        }));
        o.store.saveVectors(space, rows);
        for (const r of rows) have.set(r.id, { hash: r.hash, vec: r.vec });
      }
      let q = queries.get(query);
      if (!q) {
        q = (await embedTexts(endpoint, [query], o.fetch))[0] as number[];
        queries.set(query, q);
      }
      if (o.statusFile && existsSync(o.statusFile)) rmSync(o.statusFile, { force: true });
      const vectors = new Map<string, number[]>();
      for (const n of notes) {
        const v = have.get(n.id);
        if (v && v.hash === hashText(n.text)) vectors.set(n.id, v.vec);
      }
      return { vectors, query: q };
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };
  return { source, failure: () => failed };
}

/** What `remy doctor` shows: the recorded failure from an earlier session, if there is one. */
export function readEmbeddingStatus(
  home: string,
  on: boolean,
  personalising: boolean,
): EmbeddingStatus {
  if (!on) return { state: 'off' };
  if (!personalising) return { state: 'unavailable', detail: 'personalising is off' };
  try {
    const j = JSON.parse(readFileSync(embeddingStatusFile(home), 'utf8')) as {
      at?: string;
      detail?: string;
    };
    return {
      state: 'failed',
      detail: `${j.detail ?? 'the endpoint failed'} (${(j.at ?? '').slice(0, 10)})`,
    };
  } catch {
    return { state: 'on' };
  }
}

export const embeddingStatusFile = (home: string): string => join(home, 'embeddings-status.json');
