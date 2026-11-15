// `remy serve link`: a code made in the command's own process, only its hash handed to the server
// through an owner-only file, and the attacks on that file.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import {
  announceListening,
  LINK_REQUEST_FILE,
  LINK_REQUEST_MAX_AGE_MS,
  LISTENING_FILE,
  linkLines,
  originFromUrl,
  readListening,
  requestCodes,
  takeLinkRequest,
  watchLinkRequests,
} from './serve-link.ts';
import { createSignInCodes } from './serve-signin.ts';
import { sha256Hex } from './webhook-token.ts';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-link-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const requestPath = () => join(home, LINK_REQUEST_FILE);
const write = (body: unknown, mode = 0o600) => {
  writeFileSync(requestPath(), typeof body === 'string' ? body : JSON.stringify(body), { mode });
  chmodSync(requestPath(), mode);
};
const good = (hash: string, at = Date.now()) => ({ hashes: [hash], at });

describe('takeLinkRequest', () => {
  it('turns the hashes into codes, once, and deletes the file', () => {
    const codes = createSignInCodes();
    write(good(sha256Hex('my-code')));
    expect(takeLinkRequest(home, codes)).toBe('adopted');
    expect(existsSync(requestPath())).toBe(false);
    expect(codes.redeem('my-code')).toBe(true);
    expect(codes.redeem('my-code')).toBe(false);
    expect(takeLinkRequest(home, codes)).toBe('none');
  });

  it('refuses and deletes a file anyone else could have written', () => {
    const codes = createSignInCodes();
    if (process.platform !== 'win32') {
      write(good(sha256Hex('open')), 0o644); // readable by others
      expect(takeLinkRequest(home, codes)).toBe('ignored');
      expect(existsSync(requestPath())).toBe(false);
      write(good(sha256Hex('open')), 0o666); // writable by others
      expect(takeLinkRequest(home, codes)).toBe('ignored');
    }
    expect(codes.redeem('open')).toBe(false);
  });

  it('refuses a file that belongs to another user', () => {
    const codes = createSignInCodes();
    write(good(sha256Hex('theirs')));
    expect(takeLinkRequest(home, codes, { uid: (process.getuid?.() ?? 0) + 1 })).toBe('ignored');
    expect(codes.redeem('theirs')).toBe(false);
    expect(existsSync(requestPath())).toBe(false);
  });

  it('refuses a symbolic link in its place and does not read through it', () => {
    const codes = createSignInCodes();
    const elsewhere = join(home, 'elsewhere.json');
    writeFileSync(elsewhere, JSON.stringify(good(sha256Hex('linked'))), { mode: 0o600 });
    symlinkSync(elsewhere, requestPath());
    expect(takeLinkRequest(home, codes)).toBe('ignored');
    expect(codes.redeem('linked')).toBe(false);
    expect(existsSync(elsewhere)).toBe(true); // only the link was removed
  });

  it('refuses an old request, one from the future, and a bad shape', () => {
    const codes = createSignInCodes();
    const hash = sha256Hex('x');
    for (const body of [
      good(hash, Date.now() - LINK_REQUEST_MAX_AGE_MS - 1000),
      good(hash, Date.now() + LINK_REQUEST_MAX_AGE_MS + 1000),
      { hashes: [], at: Date.now() },
      { hashes: ['nothex'], at: Date.now() },
      { hashes: [hash, hash, hash, hash, hash], at: Date.now() },
      { hashes: [hash], at: Date.now(), extra: 1 },
      { hashes: hash, at: Date.now() },
      '{not json',
      '[]',
      `{"hashes":["${hash}"],"at":${Date.now()}}${' '.repeat(3000)}`,
    ]) {
      write(body);
      expect(takeLinkRequest(home, codes)).toBe('ignored');
      expect(existsSync(requestPath())).toBe(false);
    }
    expect(codes.redeem('x')).toBe(false);
  });

  it('logs that it ignored one, without the contents', () => {
    const lines: string[] = [];
    write('{"hashes":["secret-looking-text"]}');
    takeLinkRequest(home, createSignInCodes(), { log: (l) => lines.push(l) });
    expect(lines).toEqual(['serve: ignored a sign-in link request that was not valid']);
  });

  it('is picked up by the watcher', async () => {
    const codes = createSignInCodes();
    const stop = watchLinkRequests(home, codes, { pollMs: 10 });
    try {
      write(good(sha256Hex('watched')));
      for (let i = 0; i < 200 && existsSync(requestPath()); i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(codes.redeem('watched')).toBe(true);
    } finally {
      stop();
    }
  });
});

describe('requestCodes (the command)', () => {
  /** A stand-in for the server: takes the request the next time the command sleeps. */
  const server = (codes = createSignInCodes()) => ({
    codes,
    sleep: async () => {
      takeLinkRequest(home, codes);
    },
  });

  it('makes codes the server then accepts, and leaves no file behind', async () => {
    const s = server();
    const made = await requestCodes(home, 2, { sleep: s.sleep });
    expect(made).toHaveLength(2);
    expect(made[0]).not.toBe(made[1]);
    expect(made[0]?.length).toBeGreaterThanOrEqual(43);
    expect(readdirSync(home)).toEqual([]);
    expect(s.codes.redeem(made[1] as string)).toBe(true);
    expect(s.codes.redeem(made[0] as string)).toBe(true);
    expect(s.codes.redeem(made[0] as string)).toBe(false);
  });

  it('puts only hashes in the file, owner only, and never the code', async () => {
    let seen = '';
    let mode = 0;
    let made: string[] = [];
    const codes = createSignInCodes();
    made = await requestCodes(home, 1, {
      sleep: async () => {
        seen = readFileSync(requestPath(), 'utf8');
        mode = statSync(requestPath()).mode & 0o777;
        takeLinkRequest(home, codes);
      },
    });
    expect(mode).toBe(0o600);
    expect(seen).toContain(sha256Hex(made[0] as string));
    expect(seen).not.toContain(made[0] as string);
  });

  it('refuses while another request waits', async () => {
    write(good(sha256Hex('other')));
    await expect(requestCodes(home, 1, { sleep: async () => {} })).rejects.toThrow(
      /Another sign-in link/,
    );
    expect(existsSync(requestPath())).toBe(true); // the other one is untouched
  });

  it('replaces an old request nobody took', async () => {
    write(good(sha256Hex('stale'), Date.now() - 10 * 60_000));
    const old = new Date(Date.now() - 10 * 60_000);
    // make its mtime old too
    const { utimesSync } = await import('node:fs');
    utimesSync(requestPath(), old, old);
    const s = server();
    const made = await requestCodes(home, 1, { sleep: s.sleep });
    expect(s.codes.redeem(made[0] as string)).toBe(true);
    expect(s.codes.redeem('stale')).toBe(false);
  });

  it('gives up with a plain sentence when the server does not answer, and removes its file', async () => {
    let t = 0;
    await expect(
      requestCodes(home, 1, {
        now: () => t,
        sleep: async () => {
          t += 2000;
        },
        waitMs: 5000,
      }),
    ).rejects.toThrow(/Remy did not answer/);
    expect(existsSync(requestPath())).toBe(false);
  });
});

describe('where the server listens', () => {
  it('is announced in a private file and removed on the way out', () => {
    const done = announceListening(home, { host: '0.0.0.0', port: 7790 });
    const file = join(home, LISTENING_FILE);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readListening(home)).toEqual({ host: '0.0.0.0', port: 7790 });
    done();
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(home)).toEqual([]);
  });

  it('is ignored when its process is gone, and a stale file is not trusted', () => {
    announceListening(home, { host: '127.0.0.1', port: 1 }, 999_999);
    expect(readListening(home, () => false)).toBeUndefined();
    writeFileSync(join(home, LISTENING_FILE), '{"pid":"x"}');
    expect(readListening(home)).toBeUndefined();
    rmSync(join(home, LISTENING_FILE));
    expect(readListening(home)).toBeUndefined();
  });

  it('is not removed by an older server that is stopping after a newer one started', () => {
    const first = announceListening(home, { host: '0.0.0.0', port: 1 }, 111);
    announceListening(home, { host: '0.0.0.0', port: 2 }, 222);
    first();
    expect(readListening(home, () => true)).toEqual({ host: '0.0.0.0', port: 2 });
  });
});

describe('--url', () => {
  it('takes an origin and nothing else', () => {
    expect(originFromUrl('http://192.168.1.20:7790')).toBe('http://192.168.1.20:7790');
    expect(originFromUrl('https://remy.tailnet.ts.net/')).toBe('https://remy.tailnet.ts.net');
    expect(originFromUrl('http://192.168.1.20:7790/some/path?x=1#y')).toBe(
      'http://192.168.1.20:7790',
    );
    for (const bad of ['', 'nope', 'ftp://host', 'javascript:alert(1)', 'http://user:pw@host'])
      expect(() => originFromUrl(bad)).toThrow(/Use --url/);
  });
});

describe('linkLines', () => {
  const ifaces = { en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] };
  const run = async (host: string, extra: { url?: string } = {}) => {
    announceListening(home, { host, port: 7790 });
    const codes = createSignInCodes();
    const lines = await linkLines(home, {
      color: false,
      interfaces: ifaces,
      sleep: async () => {
        takeLinkRequest(home, codes);
      },
      ...extra,
    });
    return { lines, codes };
  };

  it('says so when no server is running', async () => {
    await expect(linkLines(home, { color: false, interfaces: ifaces })).rejects.toThrow(
      /not running here/,
    );
  });

  it('draws a QR code for each address a phone can open', async () => {
    const { lines, codes } = await run('0.0.0.0');
    const text = lines.join('\n');
    const code = /Or open: http:\/\/192\.168\.1\.20:7790\/#\/sign-in\?code=([\w-]+)/.exec(
      text,
    )?.[1] as string;
    expect(code).toBeTruthy();
    expect(text).toContain('█');
    expect(codes.redeem(code)).toBe(true);
    expect(codes.redeem(code)).toBe(false);
  });

  it('gives a plain link, no code image, for a server on this computer only', async () => {
    const { lines, codes } = await run('127.0.0.1');
    expect(lines[0]).toContain('sign in on this computer');
    const code = /127\.0\.0\.1:7790\/#\/sign-in\?code=([\w-]+)/.exec(lines.join('\n'))?.[1];
    expect(lines.join('\n')).not.toContain('█');
    expect(codes.redeem(code as string)).toBe(true);
  });

  it('uses the address given, for a name only the person knows', async () => {
    const { lines } = await run('0.0.0.0', { url: 'https://remy.tailnet.ts.net' });
    expect(lines.join('\n')).toContain('https://remy.tailnet.ts.net/#/sign-in?code=');
  });
});

// ---- through the real command: a running server and a second invocation

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'),
  )?.address;

describe('remy serve link, against a running remy serve', () => {
  const deps = (o: { out: string; err: string }, extra: Partial<CliDeps> = {}): CliDeps => ({
    env: { REMY_HOME: home, REMY_KEYCHAIN: 'off', REMY_SERVE_ALLOW_REMOTE: 'on' },
    cwd: home,
    out: (s) => {
      o.out += s.endsWith('\n') ? s : `${s}\n`;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store: new MemoryEventStore(),
    model: new ScriptedModelClient([]),
    ...extra,
  });

  async function boot(host: string) {
    let stop: () => void = () => {};
    const serveStop = new Promise<void>((r) => {
      stop = r;
    });
    const o = { out: '', err: '' };
    const running = cli(['serve', '--host', host, '--port', '0'], deps(o, { serveStop }));
    for (let i = 0; i < 300 && !/listens on/.test(o.out); i++)
      await new Promise((r) => setTimeout(r, 10));
    const port = Number(/listens on http:\/\/[^:]+:(\d+)/.exec(o.out)?.[1]);
    return {
      o,
      port,
      stop: async () => {
        stop();
        await running;
      },
    };
  }
  const exchange = (base: string, code: string) =>
    fetch(`${base}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });

  it('makes a link that signs in once, while the server runs', async () => {
    const server = await boot('127.0.0.1');
    expect(existsSync(join(home, LISTENING_FILE))).toBe(true);
    const o = { out: '', err: '' };
    expect(await cli(['serve', 'link'], deps(o, { isTTY: true }))).toBe(0);
    const out = plain(o.out);
    const code = /127\.0\.0\.1:\d+\/#\/sign-in\?code=([\w-]+)/.exec(out)?.[1] as string;
    expect(code).toBeTruthy();
    // the code is on the terminal only: not in a file, not in the server's output
    for (const f of readdirSync(home))
      if (statSync(join(home, f)).isFile() && !/\.(db|sqlite)/.test(f))
        expect(readFileSync(join(home, f), 'utf8').includes(code), f).toBe(false);
    expect(server.o.out).not.toContain(code);
    const base = `http://127.0.0.1:${server.port}`;
    expect((await exchange(base, code)).status).toBe(200);
    expect((await exchange(base, code)).status).toBe(401);
    await server.stop();
    expect(existsSync(join(home, LISTENING_FILE))).toBe(false);
  }, 20_000);

  it.skipIf(!lanAddress)(
    'on every interface it draws a QR code, and the phone signs in from the LAN address',
    async () => {
      const server = await boot('0.0.0.0');
      const o = { out: '', err: '' };
      expect(await cli(['serve', 'link'], deps(o, { isTTY: true }))).toBe(0);
      const out = plain(o.out);
      expect(out).toContain('scan this with its camera');
      expect(o.out).toContain('█');
      const code = new RegExp(
        `http://${(lanAddress as string).replaceAll('.', '\\.')}:${server.port}/#/sign-in\\?code=([\\w-]+)`,
      ).exec(out)?.[1] as string;
      expect(code).toBeTruthy();
      const base = `http://${lanAddress}:${server.port}`;
      expect((await exchange(base, code)).status).toBe(200);
      expect((await exchange(base, code)).status).toBe(401);
      await server.stop();
    },
    20_000,
  );

  it('is refused off a terminal, where the code could be kept', async () => {
    const server = await boot('127.0.0.1');
    const o = { out: '', err: '' };
    expect(await cli(['serve', 'link'], deps(o))).toBe(1);
    expect(o.err).toMatch(/only on a terminal/);
    expect(o.out).not.toContain('code=');
    expect(existsSync(requestPath())).toBe(false);
    await server.stop();
  }, 20_000);

  it('says so when no server runs', async () => {
    mkdirSync(home, { recursive: true });
    const o = { out: '', err: '' };
    expect(await cli(['serve', 'link'], deps(o, { isTTY: true }))).toBe(1);
    expect(o.err).toMatch(/not running here/);
  });

  it('a request written by someone else is not turned into a sign-in', async () => {
    const server = await boot('127.0.0.1');
    write(good(sha256Hex('planted')), 0o666);
    for (let i = 0; i < 300 && existsSync(requestPath()); i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(requestPath())).toBe(false);
    expect((await exchange(`http://127.0.0.1:${server.port}`, 'planted')).status).toBe(401);
    await server.stop();
  }, 20_000);
});
