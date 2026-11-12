// Reading services: when a page cannot be read directly (blocked, a script-only shell, a bot check),
// Remy may hand its address to a service the person set up. The address is vetted first with the
// same rules a direct fetch applies, so a service is never used to reach what Remy would refuse.
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { isPrivateAddress } from './scoped-fetch.ts';

export interface PageReader {
  name: string;
  read(
    url: string,
    opts: { signal: AbortSignal; maxChars: number },
  ): Promise<{ title?: string; text: string; finalUrl?: string }>;
}

/** A reading service that will not work until something changes (bad key, no credit). */
export class ReaderUnavailable extends Error {}

export const READER_TIMEOUT_MS = 20_000;

export type UrlVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The checks `fetch_url` applies before a direct fetch: http or https only, and no host that is or
 * resolves to a loopback, private, link-local, CGNAT, metadata or otherwise non-public address.
 * Any one private address among several refuses the URL. A host that cannot be resolved is refused.
 */
export async function vetPublicUrl(
  rawUrl: string,
  opts: {
    lookup?: (host: string) => Promise<string[]>;
    blockAddress?: (ip: string) => boolean;
  } = {},
): Promise<UrlVerdict> {
  const blocked = opts.blockAddress ?? isPrivateAddress;
  const lookup =
    opts.lookup ??
    (async (h: string) => (await dns.lookup(h, { all: true })).map((a) => a.address));
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Invalid URL: ${rawUrl}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: `Only http and https URLs are allowed: ${url.protocol}` };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let addrs: string[];
  if (isIP(host)) addrs = [host];
  else if (host === 'localhost' || host.endsWith('.localhost')) addrs = ['127.0.0.1', '::1'];
  else {
    try {
      addrs = await lookup(host);
    } catch {
      return { ok: false, reason: `Could not resolve ${host}` };
    }
    if (addrs.length === 0) return { ok: false, reason: `Could not resolve ${host}` };
  }
  if (addrs.some((a) => blocked(a)))
    return { ok: false, reason: `Blocked: ${host} resolves to a non-public address` };
  return { ok: true };
}

const BOT_CHECK =
  /just a moment|checking your browser|verify(ing)? (that )?you are (a )?human|attention required|captcha|are you a robot|unusual traffic|access denied|enable javascript and cookies|cf-chl|press (&|and) hold/i;

/**
 * True when a page that answered 200 gave nothing worth reading: a bot-check page, or a script-only
 * shell (an HTML page with scripts and under about 200 characters of text).
 */
export function looksUnreadable(p: { body: string; text: string; isHtml: boolean }): boolean {
  const t = p.text.trim();
  if (t.length < 2_000 && BOT_CHECK.test(t)) return true;
  return p.isHtml && t.length < 200 && /<script/i.test(p.body);
}

/** Statuses a reading service might get past. */
export const READER_STATUSES = new Set([401, 403, 429, 503]);

type FetchLike = typeof fetch;

async function call(
  name: string,
  doFetch: FetchLike,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(READER_TIMEOUT_MS)]),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new Error(`${name} timed out.`);
    throw new Error(`${name} could not be reached.`);
  }
  if (res.status === 401 || res.status === 403)
    throw new ReaderUnavailable(`${name} refused the key (HTTP ${res.status}).`);
  if (res.status === 402) throw new ReaderUnavailable(`${name} is out of credit (HTTP 402).`);
  if (res.status === 429) throw new Error(`${name} is limiting requests right now (HTTP 429).`);
  if (!res.ok) throw new Error(`${name} returned HTTP ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${name} sent a reply Remy could not read.`);
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function firecrawlReader(apiKey: string, opts: { fetch?: FetchLike } = {}): PageReader {
  const name = 'Firecrawl';
  return {
    name,
    async read(url, { signal }) {
      const data = obj(
        await call(
          name,
          opts.fetch ?? fetch,
          'https://api.firecrawl.dev/v2/scrape',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
          },
          signal,
        ),
      );
      if (data.success === false) throw new Error(`${name} could not read the page.`);
      const d = obj(data.data);
      const meta = obj(d.metadata);
      const rawTitle = meta.title;
      const title = str(Array.isArray(rawTitle) ? rawTitle[0] : rawTitle);
      const finalUrl = str(meta.url) ?? str(meta.sourceURL);
      return {
        text: str(d.markdown) ?? '',
        ...(title && { title }),
        ...(finalUrl && { finalUrl }),
      };
    },
  };
}

export function cloudflareReader(
  accountId: string,
  apiToken: string,
  opts: { fetch?: FetchLike } = {},
): PageReader {
  const name = 'Cloudflare Browser Rendering';
  return {
    name,
    async read(url, { signal }) {
      const data = obj(
        await call(
          name,
          opts.fetch ?? fetch,
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-run/markdown`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` },
            body: JSON.stringify({ url }),
          },
          signal,
        ),
      );
      if (data.success === false) throw new Error(`${name} could not read the page.`);
      return { text: str(data.result) ?? '' };
    },
  };
}
