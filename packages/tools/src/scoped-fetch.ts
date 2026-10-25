import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { FetchResult, ScopedFetch } from '@remy/core';

export class NetError extends Error {
  override name = 'NetError';
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export interface ScopedFetchOptions {
  /** host -> IP addresses. Defaults to the system resolver. */
  lookup?: (host: string) => Promise<string[]>;
  /** True if the address must not be contacted. Defaults to isPrivateAddress. */
  blockAddress?: (ip: string) => boolean;
  /** Domain allowlist: exact match or subdomain. */
  allow?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

function parseV6(input: string): number[] | null {
  let ip = input.split('%')[0] ?? '';
  const tail = ip.lastIndexOf(':');
  const v4 = ip.includes('.') ? parseV4(ip.slice(tail + 1)) : null;
  if (ip.includes('.')) {
    if (!v4) return null;
    const [a, b, c, d] = v4 as [number, number, number, number];
    ip = `${ip.slice(0, tail + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const side = (s: string) => (s === '' ? [] : s.split(':'));
  const head = side(halves[0] ?? '');
  const rest = side(halves[1] ?? '');
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) =>
    /^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

function privateV4([a = 0, b = 0, c = 0]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Loopback, private, link-local, CGNAT, multicast, unspecified and unparseable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return privateV4(v4);
  const g = parseV6(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g7 === 1)) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return privateV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]); // IPv4-mapped / compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b) return privateV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  if (g0 === 0x2002) return privateV4([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]); // 6to4
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function createScopedFetch(opts: ScopedFetchOptions = {}): ScopedFetch {
  const blocked = opts.blockAddress ?? isPrivateAddress;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const allow = opts.allow?.map((d) => d.toLowerCase());
  const resolveHost =
    opts.lookup ??
    (async (host: string) => (await dns.lookup(host, { all: true })).map((a) => a.address));

  const addressesFor = async (host: string): Promise<string[]> => {
    if (isIP(host)) return [host];
    if (host === 'localhost' || host.endsWith('.localhost')) return ['127.0.0.1', '::1'];
    let found: string[];
    try {
      found = await resolveHost(host);
    } catch (e) {
      throw new NetError(`Could not resolve ${host}: ${(e as Error).message}`, true);
    }
    if (found.length === 0) throw new NetError(`Could not resolve ${host}`);
    return found;
  };

  const vet = (host: string, addrs: string[]) => {
    for (const a of addrs) {
      if (blocked(a)) throw new NetError(`Blocked: ${host} resolves to a non-public address`);
    }
  };

  // Validates at connect time, so the address checked is the address used.
  const guardedLookup: LookupFunction = (host, options, cb) => {
    addressesFor(host).then(
      (addrs) => {
        try {
          vet(host, addrs);
        } catch (e) {
          return cb(e as Error, '', 4);
        }
        const list = addrs.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
        if (options.all) return cb(null, list);
        const first = list[0] as { address: string; family: number };
        cb(null, first.address, first.family);
      },
      (e) => cb(e as Error, '', 4),
    );
  };

  const hop = (url: URL, signal: AbortSignal) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(
          url,
          {
            method: 'GET',
            lookup: guardedLookup,
            signal,
            headers: {
              'user-agent': 'Remy/0.0 (+https://github.com/remy-plus/remy)',
              accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if (REDIRECTS.has(status) && res.headers.location) {
              res.resume();
              return resolve({ status, headers: res.headers, body: '' });
            }
            const declared = Number(res.headers['content-length']);
            if (declared > maxBytes) {
              req.destroy();
              return reject(
                new NetError(`Response too large: ${declared} bytes (limit ${maxBytes})`),
              );
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (c: Buffer) => {
              size += c.length;
              if (size > maxBytes) {
                req.destroy();
                reject(new NetError(`Response too large (limit ${maxBytes} bytes)`));
              } else chunks.push(c);
            });
            res.on('end', () =>
              resolve({
                status,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
            res.on('error', (e) => reject(e));
          },
        );
        req.on('error', (e) => reject(e));
        req.end();
      },
    );

  return {
    async get(rawUrl, o = {}): Promise<FetchResult> {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = o.signal ? AbortSignal.any([timeout, o.signal]) : timeout;
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        throw new NetError(`Invalid URL: ${rawUrl}`);
      }
      for (let redirects = 0; ; redirects++) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new NetError(`Only http and https URLs are allowed: ${url.protocol}`);
        }
        const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (allow && !allow.some((d) => host === d || host.endsWith(`.${d}`))) {
          throw new NetError(`Blocked: ${host} is not on the allowed domain list`);
        }
        if (isIP(host)) vet(host, [host]);
        else if (host === 'localhost' || host.endsWith('.localhost')) {
          vet(host, ['127.0.0.1', '::1']);
        }
        let res: Awaited<ReturnType<typeof hop>>;
        try {
          res = await hop(url, signal);
        } catch (e) {
          if (e instanceof NetError) throw e;
          const cause = (e as { cause?: unknown }).cause;
          if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
            throw new NetError(`Request timed out or was cancelled: ${url.href}`, true);
          }
          if (cause instanceof NetError) throw cause;
          throw new NetError(`Request failed: ${(e as Error).message}`, true);
        }
        const location = res.headers.location;
        if (REDIRECTS.has(res.status) && location) {
          if (redirects >= maxRedirects)
            throw new NetError(`Too many redirects (limit ${maxRedirects})`);
          try {
            url = new URL(location, url);
          } catch {
            throw new NetError(`Invalid redirect target: ${location}`);
          }
          continue;
        }
        return {
          url: url.href,
          status: res.status,
          contentType: String(res.headers['content-type'] ?? ''),
          body: res.body,
        };
      }
    },
  };
}
