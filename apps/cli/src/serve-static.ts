// Static hosting for `remy serve`: the built web app (a Vite single-page app) as plain files, on the
// same port as the API. Rules, all tested:
//  - only GET and HEAD; anything else is 405;
//  - the path is decoded once, then refused if it holds a NUL, a backslash or a `.` or `..` segment;
//    the resolved file must stay inside the web root, symlinks included (checked on the real path);
//  - a path with a segment starting with a dot is a plain 404, as if missing;
//  - no directory listing: a directory is never served;
//  - a path with no file extension gets index.html (the app routes on its own); a missing file with
//    an extension is a plain 404;
//  - files are streamed, never read into memory;
//  - every answer carries a strict content security policy and the usual hardening headers.
// No token is needed for these files: they hold no data. The API under /api stays protected.
import { existsSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

// Images are the only remote content allowed (https only, never http): the web app shows a registry
// record's icon as an <img>. The markdown renderer never renders images, so only vetted icons use this.
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export const NOT_BUILT = 'The web app is not built. Run pnpm --filter @remy/web build.';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Where the built web app is: a `web/` folder next to the running bundle (the released package),
 * else `apps/web/dist` when running from source. Undefined when neither holds an index.html.
 */
export function findWebRoot(
  here: string = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  for (const dir of [join(here, 'web'), resolve(here, '..', '..', 'web', 'dist')])
    if (existsSync(join(dir, 'index.html'))) return dir;
  return undefined;
}

/**
 * Makes the handler for non-API requests. `root` is a fixed folder; without it the folder is looked
 * for on each request until it is found, so a build that finishes later is picked up.
 */
export function createStaticHandler(opts: { root?: string } = {}) {
  let found = opts.root;
  const rootNow = (): { root: string; real: string } | undefined => {
    const root = found ?? findWebRoot();
    if (!root) return undefined;
    try {
      const real = realpathSync(root);
      found = root;
      return { root: resolve(root), real };
    } catch {
      return undefined;
    }
  };

  const json = (res: ServerResponse, status: number, body: unknown, extra = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...extra,
    });
    res.end(text);
  };

  /** Turns a request target into path segments, or undefined when the path is not acceptable. */
  const segmentsOf = (
    target: string,
  ): { parts: string[]; slash: boolean; hidden?: boolean } | undefined => {
    const raw = target.split(/[?#]/, 1)[0] ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith('/'))
      return undefined;
    const parts = decoded.split('/').slice(1);
    if (parts.some((p) => p === '..' || p === '.')) return undefined;
    // A dotfile (.env, .git, .well-known) is never served: it answers as a missing file.
    if (parts.some((p) => p.startsWith('.'))) return { parts, slash: false, hidden: true };
    return { parts: parts.filter((p) => p !== ''), slash: decoded.endsWith('/') };
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD')
      return json(
        res,
        405,
        { error: 'Only GET and HEAD are allowed here.' },
        { allow: 'GET, HEAD' },
      );
    const where = rootNow();
    if (!where) return json(res, 404, { error: NOT_BUILT });
    const given = segmentsOf(req.url ?? '/');
    if (!given) return json(res, 400, { error: 'That path is not allowed.' });

    if (given.hidden) return json(res, 404, { error: 'Not found.' });
    const { parts, slash } = given;
    const wanted = parts.length === 0 ? 'index.html' : parts.join('/');
    const hasExt = extname(parts[parts.length - 1] ?? '') !== '';
    // A path with no extension is a route of the app: it gets the app.
    const candidates =
      slash && parts.length > 0
        ? ['index.html'] // a file is never reached through a trailing slash
        : hasExt || parts.length === 0
          ? [wanted]
          : [wanted, 'index.html'];

    for (const rel of candidates) {
      const file = resolve(where.root, ...rel.split('/'));
      if (!file.startsWith(where.root + sep)) continue;
      let real: string;
      try {
        real = realpathSync(file);
      } catch {
        continue;
      }
      if (!real.startsWith(where.real + sep)) continue; // a symlink out of the root
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(real, 'r');
        const info = await handle.stat();
        if (!info.isFile()) {
          await handle.close();
          continue; // a directory is never listed
        }
        const isIndex = real === join(where.real, 'index.html');
        const immutable = rel.startsWith('assets/');
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(info.size),
          'cache-control': immutable
            ? 'public, max-age=31536000, immutable'
            : isIndex
              ? 'no-cache'
              : 'public, max-age=3600',
        });
        if (method === 'HEAD') {
          await handle.close();
          return void res.end();
        }
        const stream = handle.createReadStream({ highWaterMark: 16 * 1024 });
        pipeline(stream, res, () => {});
        return;
      } catch {
        await handle?.close().catch(() => {});
        if (res.headersSent) return void res.destroy();
        return json(res, 404, { error: 'Not found.' });
      }
    }
    json(res, 404, { error: 'Not found.' });
  }

  return handle;
}
