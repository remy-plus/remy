// `remy serve` routes for the brain: the notes Remy keeps about the person. What the web app's
// Brain screen calls.
//
//   GET    /api/brain?q=&kind=   notes, counts by kind, and the links between them
//   GET    /api/brain/:id        one note
//   PUT    /api/brain/:id        {text}  replace the note's text
//   DELETE /api/brain/:id        forget only that note
//
// Search is the same recall Remy uses in a task: BM25 over the words, plus the vectors when the
// person turned embeddings on (`semantic`). The store has three kinds (preference, about_you,
// how_to); the screen has four names, so they map as: about_you -> person, preference -> fact,
// how_to -> how-to. "project" has no matching kind in the CLI and always counts zero. The only
// relation the store has between notes is "may contradict" (conflictsWith), so that is the only
// kind of link drawn; a note with none has no links. A note's position in the graph is a stable
// function of its id, not data.
import { createHash } from 'node:crypto';
import {
  MEMORY_MAX_CHARS,
  type MemoryEntry,
  type MemoryKind,
  rankScores,
  type SemanticSource,
} from '@remy/tools';
import { z } from 'zod';
import type { MemoryStore } from './memory.ts';
import {
  guard,
  HttpFail,
  idOf,
  jsonBody,
  type Mount,
  methodNotAllowed,
  ok,
} from './serve-mount.ts';

export interface BrainMountDeps {
  memory: Pick<MemoryStore, 'list' | 'remove' | 'edit'>;
  /** Vectors for ranking when embeddings are on; absent or undefined results mean word matching. */
  semantic?: SemanticSource;
  now?: () => Date;
}

type WebKind = 'person' | 'project' | 'how-to' | 'fact';
const WEB_KINDS: WebKind[] = ['person', 'project', 'how-to', 'fact'];
const KIND_OF: Record<MemoryKind, WebKind> = {
  about_you: 'person',
  preference: 'fact',
  how_to: 'how-to',
};
const NOTES_MAX = 200;
const QUERY_MAX = 200;
const putBody = z.object({ text: z.string().trim().min(1).max(MEMORY_MAX_CHARS) }).strict();

const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Two stable numbers from an id, for a place in the graph (6 to 94 each way). */
function place(id: string): { x: number; y: number } {
  const h = createHash('sha256').update(id).digest();
  return { x: 6 + ((h[0] as number) % 89), y: 6 + ((h[1] as number) % 89) };
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function createBrainMount(deps: BrainMountDeps): Mount {
  const now = deps.now ?? (() => new Date());

  const view = (e: MemoryEntry, known: Set<string>) => {
    const links = (e.conflictsWith ?? []).filter((id) => known.has(id));
    const made = new Date(e.created);
    const when = Number.isNaN(made.getTime())
      ? ''
      : ` · ${made.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    return {
      id: e.id,
      title: clip(e.text, 60),
      kind: KIND_OF[e.kind],
      body: e.text,
      links,
      linkCount: links.length,
      origin: `${e.source ? 'Remy saved it' : 'You wrote it'}${when}`,
      ...place(e.id),
    };
  };

  async function list(url: URL) {
    const q = (url.searchParams.get('q') ?? '').trim();
    const kind = url.searchParams.get('kind') ?? '';
    if (q.length > QUERY_MAX) throw new HttpFail(400, 'Search for something shorter.');
    if (kind && !WEB_KINDS.includes(kind as WebKind)) throw new HttpFail(400, 'Unknown kind.');
    const all = deps.memory.list();
    const known = new Set(all.map((e) => e.id));
    const counts: Record<WebKind, number> = { person: 0, project: 0, 'how-to': 0, fact: 0 };
    for (const e of all) counts[KIND_OF[e.kind]] += 1;

    let found = all;
    if (q) {
      let semantic: Awaited<ReturnType<SemanticSource>>;
      try {
        semantic = await deps.semantic?.(all, q);
      } catch {
        semantic = undefined; // embeddings are optional: fall back to words
      }
      const scores = rankScores(
        all.map((e) => ({ id: e.id, text: e.text })),
        q,
        semantic,
      );
      // `all` is newest first, and the sort is stable, so ties stay newest first.
      found = all
        .filter((e) => (scores.get(e.id) ?? 0) > 0)
        .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    }
    if (kind) found = found.filter((e) => KIND_OF[e.kind] === kind);
    const notes = found.slice(0, NOTES_MAX).map((e) => view(e, known));
    const today = now();
    return {
      total: all.length,
      newToday: all.filter((e) => sameDay(new Date(e.created), today)).length,
      counts,
      notes,
      selected: notes[0]?.id ?? '',
    };
  }

  const exists = (id: string) => deps.memory.list().some((e) => e.id === id);

  return guard(async ({ req, method, url, parts }) => {
    const [head, id] = parts;
    if (head !== 'brain' || parts.length > 2) return undefined;
    if (parts.length === 1) {
      if (method !== 'GET') return methodNotAllowed('GET');
      return ok(await list(url));
    }
    const nid = idOf(id);
    if (method === 'GET') {
      const all = deps.memory.list();
      const hit = all.find((e) => e.id === nid);
      if (!hit) throw new HttpFail(404, 'There is no such note.');
      return ok({ note: view(hit, new Set(all.map((e) => e.id))) });
    }
    if (method === 'PUT') {
      const b = await jsonBody(req, putBody);
      if (!exists(nid)) throw new HttpFail(404, 'There is no such note.');
      if (!deps.memory.edit(nid, b.text)) throw new HttpFail(400, 'That text cannot be saved.');
      return ok();
    }
    if (method === 'DELETE') {
      if (!deps.memory.remove(nid)) throw new HttpFail(404, 'There is no such note.');
      return ok();
    }
    return methodNotAllowed('GET', 'PUT', 'DELETE');
  });
}
