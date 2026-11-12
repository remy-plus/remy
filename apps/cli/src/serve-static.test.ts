import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStaticHandler, findWebRoot, NOT_BUILT, SECURITY_HEADERS } from './serve-static.ts';

let dir: string;
let root: string;
let servers: Server[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-static-'));
  root = join(dir, 'web');
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'empty.d'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Remy</title>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'index-abc123.css'), 'body{}');
  writeFileSync(join(root, 'assets', 'font-1.woff2'), 'wOF2');
  writeFileSync(join(root, 'logo.svg'), '<svg/>');
  writeFileSync(join(root, 'logo.png'), 'png');
  writeFileSync(join(root, 'favicon.ico'), 'ico');
  writeFileSync(join(root, 'data.json'), '{}');
  writeFileSync(join(root, 'app.webmanifest'), '{}');
  writeFileSync(join(dir, 'secret.txt'), 'top secret');
  mkdirSync(join(dir, 'outside'));
  writeFileSync(join(dir, 'outside', 'x.js'), 'outside');
});
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  rmSync(dir, { recursive: true, force: true });
});

async function start(webRoot: string = root) {
  const handler = createStaticHandler({ root: webRoot });
  const server = createServer((req, res) => void handler(req, res));
  server.keepAliveTimeout = 1;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

/** A raw request, so the path reaches the server exactly as written (fetch would normalise it). */
function raw(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    },
  );
}

describe('security headers', () => {
  it('allow https images and nothing else remote', async () => {
    const port = await start();
    const csp = String((await raw(port, '/')).headers['content-security-policy']);
    expect(csp).toContain("img-src 'self' data: https:;");
    expect(csp).not.toMatch(/http:(?!\/)/);
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'"])
      expect(csp).toContain(d);
    expect(SECURITY_HEADERS['content-security-policy']).toBe(csp);
  });
});

describe('dotfiles', () => {
  it('answer 404 like a missing file', async () => {
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(root, 'assets', '.hidden'), 'x');
    mkdirSync(join(root, '.well-known'));
    writeFileSync(join(root, '.well-known', 'x'), 'x');
    const port = await start();
    for (const path of ['/.env', '/assets/.hidden', '/.well-known/x', '/.well-known/', '/%2eenv']) {
      const r = await raw(port, path);
      expect(r.status, path).toBe(404);
      expect(r.body).not.toContain('SECRET');
    }
  });
});

describe('static files', () => {
  it('serves index.html at the root and for routes with no extension', async () => {
    const port = await start();
    for (const path of ['/', '/tasks', '/tasks/task_1', '/assets', '/empty.d/x', '/?mock=1']) {
      const r = await raw(port, path);
      expect(r.status, path).toBe(200);
      expect(r.body).toContain('<title>Remy</title>');
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves hashed assets as immutable', async () => {
    const port = await start();
    const r = await raw(port, '/assets/index-abc123.js');
    expect(r.status).toBe(200);
    expect(r.body).toBe('console.log(1)');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('sets the right content type for each kind of file', async () => {
    const port = await start();
    const want: Record<string, string> = {
      '/assets/index-abc123.js': 'text/javascript; charset=utf-8',
      '/assets/index-abc123.css': 'text/css; charset=utf-8',
      '/assets/font-1.woff2': 'font/woff2',
      '/logo.svg': 'image/svg+xml',
      '/logo.png': 'image/png',
      '/favicon.ico': 'image/x-icon',
      '/data.json': 'application/json; charset=utf-8',
      '/app.webmanifest': 'application/manifest+json; charset=utf-8',
      '/index.html': 'text/html; charset=utf-8',
    };
    for (const [path, type] of Object.entries(want))
      expect((await raw(port, path)).headers['content-type'], path).toBe(type);
  });

  it('answers HEAD with headers and no body', async () => {
    const port = await start();
    const r = await raw(port, '/assets/index-abc123.js', 'HEAD');
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
    expect(r.headers['content-length']).toBe('14');
  });

  it('refuses every method but GET and HEAD', async () => {
    const port = await start();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await raw(port, '/', method);
      expect(r.status, method).toBe(405);
      expect(r.headers.allow).toBe('GET, HEAD');
    }
  });

  it('answers 404 for a missing file that has an extension', async () => {
    const port = await start();
    expect((await raw(port, '/nope.js')).status).toBe(404);
    expect((await raw(port, '/assets/nope.css')).status).toBe(404);
  });

  it('answers 404 with a plain message when the web app is not built', async () => {
    const port = await start(join(dir, 'missing'));
    for (const path of ['/', '/assets/a.js', '/tasks']) {
      const r = await raw(port, path);
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ error: NOT_BUILT });
      expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    }
  });

  it('never lists a directory', async () => {
    const port = await start();
    const r = await raw(port, '/empty.d/');
    expect(r.body).not.toContain('empty.d');
    const file = await raw(port, '/assets/index-abc123.js/');
    expect(file.body).not.toContain('console');
  });

  it('refuses every way of climbing out of the root', async () => {
    const port = await start();
    const attempts = [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/%2E%2E%2Fsecret.txt',
      '/assets/../../secret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/..\\secret.txt',
      '/%5c..%5csecret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/%252e%252e/secret.txt',
      '/....//secret.txt',
      '/index.html%00.png',
      '/%00',
      '/assets/%00../../secret.txt',
      '/%c0%ae%c0%ae/secret.txt',
      '/%',
      '/%zz',
      `/${'..%2f'.repeat(10)}etc/passwd`,
    ];
    for (const path of attempts) {
      const r = await raw(port, path);
      expect(r.body, path).not.toContain('top secret');
      expect(r.body, path).not.toContain('root:');
      expect([200, 400, 404], path).toContain(r.status);
      // 200 is only acceptable when the answer is the app itself.
      if (r.status === 200) expect(r.body, path).toContain('<title>Remy</title>');
    }
    for (const path of [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/..\\x',
      '/%00',
    ])
      expect((await raw(port, path)).status, path).toBe(400);
  });

  it('refuses a symlink that leads out of the root', async () => {
    symlinkSync(join(dir, 'secret.txt'), join(root, 'link.txt'));
    symlinkSync(join(dir, 'outside'), join(root, 'linkdir'));
    symlinkSync(join(dir, 'outside', 'x.js'), join(root, 'assets', 'evil.js'));
    const port = await start();
    for (const path of ['/link.txt', '/linkdir/x.js', '/assets/evil.js']) {
      const r = await raw(port, path);
      expect(r.status, path).toBe(404);
      expect(r.body, path).not.toContain('top secret');
      expect(r.body, path).not.toContain('outside');
    }
  });

  it('follows a symlink that stays inside the root', async () => {
    symlinkSync(join(root, 'logo.svg'), join(root, 'same.svg'));
    const port = await start();
    expect((await raw(port, '/same.svg')).status).toBe(200);
  });

  it('refuses an index.html that is a symlink out of the root', async () => {
    rmSync(join(root, 'index.html'));
    symlinkSync(join(dir, 'secret.txt'), join(root, 'index.html'));
    const port = await start();
    const r = await raw(port, '/');
    expect(r.status).toBe(404);
    expect(r.body).not.toContain('top secret');
  });

  it('puts the security headers on every answer', async () => {
    const port = await start();
    for (const [path, method] of [
      ['/', 'GET'],
      ['/assets/index-abc123.js', 'GET'],
      ['/assets/index-abc123.js', 'HEAD'],
      ['/nope.js', 'GET'],
      ['/', 'POST'],
      ['/../x', 'GET'],
    ] as const) {
      const r = await raw(port, path, method);
      for (const [name, value] of Object.entries(SECURITY_HEADERS))
        expect(r.headers[name], `${method} ${path} ${name}`).toBe(value);
    }
    expect(SECURITY_HEADERS['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(SECURITY_HEADERS['x-frame-options']).toBe('DENY');
    expect(SECURITY_HEADERS['referrer-policy']).toBe('no-referrer');
    expect(SECURITY_HEADERS['x-content-type-options']).toBe('nosniff');
  });

  it('streams a large file in full', async () => {
    const big = 'a'.repeat(3 * 1024 * 1024);
    writeFileSync(join(root, 'assets', 'big-1.js'), big);
    const port = await start();
    const r = await raw(port, '/assets/big-1.js');
    expect(r.body.length).toBe(big.length);
  });
});

describe('findWebRoot', () => {
  it('prefers web/ next to the bundle, then apps/web/dist', () => {
    const release = join(dir, 'apps', 'cli', 'release');
    const dist = join(dir, 'apps', 'web', 'dist');
    mkdirSync(release, { recursive: true });
    mkdirSync(dist, { recursive: true });
    expect(findWebRoot(release)).toBeUndefined();
    writeFileSync(join(dist, 'index.html'), 'x');
    expect(findWebRoot(release)).toBe(dist);
    mkdirSync(join(release, 'web'));
    writeFileSync(join(release, 'web', 'index.html'), 'x');
    expect(findWebRoot(release)).toBe(join(release, 'web'));
  });
});
