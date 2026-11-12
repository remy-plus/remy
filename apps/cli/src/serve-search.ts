// GET and PUT /api/search and POST /api/search/test: which service answers web search, a saved
// preference, and one real test search. Keys stay on the machine: nothing here accepts, returns or
// logs one. The service list comes from the injected `searchStatus`, so services added later (page
// readers, remote browsers) show up without a change here.
import { z } from 'zod';
import { guard, HttpFail, jsonBody, type Mount, methodNotAllowed, ok } from './serve-mount.ts';
import type { WebPrefsStore } from './serve-settings.ts';

export type SearchServiceKind = 'search' | 'reader' | 'browser';
export interface SearchServiceView {
  id: string;
  label: string;
  key: 'env' | 'keychain' | 'none';
  kind: SearchServiceKind;
  note?: string;
}
export interface SearchStatusView {
  chosen: string | null;
  why?: string;
  step?: string;
  order: string[];
  services: SearchServiceView[];
  /** REMY_SEARCH or remy.config.json, which beats the saved preference. */
  override: string | null;
}

export interface SearchDeps {
  prefs: WebPrefsStore;
  /** The same plan and key sources `remy search` prints, with the saved preference honoured. */
  searchStatus: () => Promise<SearchStatusView>;
  /** One real search through the service; throws a plain error. Titles only come back. */
  testSearch: (id: string) => Promise<{ title: string }[]>;
  /** Removes any secret from an error before it is returned. */
  redact?: (text: string) => string;
  now?: () => number;
  /** Minimum gap between tests. */
  testGapMs?: number;
}

const prefer = z.object({ prefer: z.string().min(1).max(32) }).strict();
const testBody = z.object({ id: z.string().min(1).max(32) }).strict();

export const SEARCH_TEST_GAP_MS = 5000;
export const MSG_TEST_TOO_SOON = 'One test at a time. Try again in a few seconds.';

export function createSearchMount(d: SearchDeps): Mount {
  const now = d.now ?? Date.now;
  const gap = d.testGapMs ?? SEARCH_TEST_GAP_MS;
  let lastTest = Number.NEGATIVE_INFINITY;
  const view = async () => {
    const s = await d.searchStatus();
    return { ...s, override: s.override ?? null, prefer: d.prefs.chosen().searchPrefer ?? null };
  };
  return guard(async ({ req, method, parts }) => {
    if (parts[0] !== 'search') return undefined;
    if (parts.length === 1) {
      if (method === 'GET') return ok(await view());
      if (method === 'PUT') {
        const { prefer: want } = await jsonBody(req, prefer);
        if (want !== 'auto') {
          const known = (await d.searchStatus()).services.some(
            (s) => s.id === want && s.kind === 'search',
          );
          if (!known) throw new HttpFail(400, 'That is not a search service Remy knows.');
        }
        try {
          d.prefs.update({ searchPrefer: want === 'auto' ? null : want });
        } catch {
          throw new HttpFail(500, 'Your choice could not be saved.');
        }
        return ok(await view());
      }
      return methodNotAllowed('GET', 'PUT');
    }
    if (parts.length === 2 && parts[1] === 'test') {
      if (method !== 'POST') return methodNotAllowed('POST');
      const { id } = await jsonBody(req, testBody);
      const svc = (await d.searchStatus()).services.find((s) => s.id === id);
      if (svc?.kind !== 'search')
        throw new HttpFail(400, 'That is not a search service Remy knows.');
      if (svc.key === 'none')
        throw new HttpFail(400, `${svc.label} has no key yet. Add one from the terminal first.`);
      const t0 = now();
      if (t0 - lastTest < gap) throw new HttpFail(429, MSG_TEST_TOO_SOON);
      lastTest = t0;
      try {
        const results = await d.testSearch(id);
        const ms = Math.max(0, now() - t0);
        const titles = results
          .slice(0, 3)
          .map((r) => (r.title || '(no title)').slice(0, 160))
          .map((t) => (d.redact ? d.redact(t) : t));
        return ok({ ok: titles.length > 0, ms, titles });
      } catch (e) {
        const raw = e instanceof Error ? e.message : '';
        const text = (d.redact ? d.redact(raw) : raw).slice(0, 200).trim();
        return ok({
          ok: false,
          ms: Math.max(0, now() - t0),
          titles: [],
          error: text || `${svc.label} did not answer.`,
        });
      }
    }
    return undefined;
  });
}
