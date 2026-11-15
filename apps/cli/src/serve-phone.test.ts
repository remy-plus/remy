// Phone sign-in: several one-time codes at once (one per address), the addresses a phone can open,
// the lines `remy serve` prints, and attacks on the exchange route with a LAN Host header.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { finish } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { encodeQr, renderQr } from './qr.ts';
import { listenServe, type ServeListening } from './serve.ts';
import { phoneUrls } from './serve-bind.ts';
import { NETWORK_WARNING, phoneSignInLines, qrLines } from './serve-phone.ts';
import {
  createSignInCodes,
  SIGN_IN_CODE_TTL_MS,
  SIGN_IN_MAX_PENDING,
  signInLinkAt,
} from './serve-signin.ts';
import { makeServeToken, makeSession, serveTokenHash, sessionHashes } from './serve-token.ts';
import { sha256Hex } from './webhook-token.ts';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

describe('several one-time codes at once', () => {
  it('keeps the others when asked, and each works once, in any order', () => {
    const codes = createSignInCodes();
    const a = codes.mint({ keep: true });
    const b = codes.mint({ keep: true });
    const c = codes.mint({ keep: true });
    expect(codes.redeem(b)).toBe(true);
    expect(codes.redeem(b)).toBe(false);
    expect(codes.redeem(c)).toBe(true);
    expect(codes.redeem(a)).toBe(true);
    expect(codes.redeem(a)).toBe(false);
  });

  it('still replaces everything by default', () => {
    const codes = createSignInCodes();
    const a = codes.mint({ keep: true });
    const b = codes.mint();
    expect(codes.redeem(a)).toBe(false);
    expect(codes.redeem(b)).toBe(true);
  });

  it('gives each code its own ten minutes', () => {
    let t = 0;
    const codes = createSignInCodes(() => t);
    const early = codes.mint({ keep: true });
    t += SIGN_IN_CODE_TTL_MS - 1000;
    const late = codes.mint({ keep: true });
    t += 2000; // the first has now expired, the second has not
    expect(codes.redeem(early)).toBe(false);
    expect(codes.redeem(late)).toBe(true);
  });

  it('holds only a few, dropping the oldest', () => {
    const codes = createSignInCodes();
    const made = Array.from({ length: SIGN_IN_MAX_PENDING + 2 }, () => codes.mint({ keep: true }));
    expect(codes.redeem(made[0] as string)).toBe(false);
    expect(codes.redeem(made[1] as string)).toBe(false);
    expect(codes.redeem(made[2] as string)).toBe(true);
    expect(codes.redeem(made.at(-1) as string)).toBe(true);
  });

  it('refuses a wrong code and leaves every right one usable', () => {
    const codes = createSignInCodes();
    const a = codes.mint({ keep: true });
    const b = codes.mint({ keep: true });
    expect(codes.redeem('nope')).toBe(false);
    expect(codes.redeem(a.slice(0, -1))).toBe(false);
    expect(codes.redeem(`${a}x`)).toBe(false);
    expect(codes.redeem(a)).toBe(true);
    expect(codes.redeem(b)).toBe(true);
  });

  it('takes a code by its hash, so the code itself never has to be stored', () => {
    const codes = createSignInCodes();
    const mine = 'a-code-made-elsewhere';
    expect(codes.adopt(sha256Hex(mine))).toBe(true);
    expect(codes.redeem(mine)).toBe(true);
    expect(codes.redeem(mine)).toBe(false);
    // the hash is not a code: sending the hash itself does not sign in
    codes.adopt(sha256Hex(mine));
    expect(codes.redeem(sha256Hex(mine))).toBe(false);
    expect(codes.redeem(mine)).toBe(true);
  });

  it('refuses a hash that is not 64 hex characters', () => {
    const codes = createSignInCodes();
    for (const bad of ['', 'abc', 'g'.repeat(64), 'A'.repeat(64), `${'a'.repeat(63)}\n`]) {
      expect(codes.adopt(bad)).toBe(false);
    }
    expect(codes.redeem('')).toBe(false);
  });

  it('expires an adopted code like any other', () => {
    let t = 0;
    const codes = createSignInCodes(() => t);
    codes.adopt(sha256Hex('later'));
    t += SIGN_IN_CODE_TTL_MS + 1;
    expect(codes.redeem('later')).toBe(false);
  });
});

describe('phoneUrls', () => {
  const ifaces = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '192.168.1.20', family: 'IPv4', internal: false },
    ],
    utun3: [{ address: '100.64.0.5', family: 'IPv4', internal: false }],
    bridge: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
  };

  it('lists every reachable address when the server listens on every interface', () => {
    expect(phoneUrls('0.0.0.0', 7790, ifaces)).toEqual([
      'http://192.168.1.20:7790',
      'http://100.64.0.5:7790',
    ]);
    expect(phoneUrls('::', 7790, ifaces)).toHaveLength(2);
  });

  it('gives the one address when the server listens on one', () => {
    expect(phoneUrls('192.168.1.20', 7790, ifaces)).toEqual(['http://192.168.1.20:7790']);
    expect(phoneUrls('fd00::5', 7790, ifaces)).toEqual(['http://[fd00::5]:7790']);
  });

  it('gives none on loopback, where a phone cannot reach it', () => {
    expect(phoneUrls('127.0.0.1', 7790, ifaces)).toEqual([]);
    expect(phoneUrls('::1', 7790, ifaces)).toEqual([]);
    expect(phoneUrls('localhost', 7790, ifaces)).toEqual([]);
  });
});

describe('phoneSignInLines', () => {
  const origins = ['http://192.168.1.20:7790', 'http://100.64.0.5:7790'];

  it('prints a link and a QR code for each address, each with its own code', () => {
    const codes = createSignInCodes();
    const lines = phoneSignInLines(origins, codes, { color: false });
    const text = lines.join('\n');
    const found = [...text.matchAll(/Or open: (http:\/\/[\d.]+:7790)\/#\/sign-in\?code=([\w-]+)/g)];
    expect(found.map((m) => m[1])).toEqual(origins);
    const [first, second] = found.map((m) => m[2] as string);
    expect(first).not.toBe(second);
    // scanning one does not spoil the other
    expect(codes.redeem(second as string)).toBe(true);
    expect(codes.redeem(first as string)).toBe(true);
    expect(codes.redeem(first as string)).toBe(false);
    expect(text).toContain('It works once, for 10 minutes.');
    expect(lines.at(-1)).toBe(NETWORK_WARNING);
  });

  it('draws the very link it prints', () => {
    const codes = createSignInCodes();
    const lines = phoneSignInLines([origins[0] as string], codes, { color: false });
    const link = /Or open: (\S+)/.exec(lines.join('\n'))?.[1] as string;
    const drawn = renderQr(encodeQr(link), { color: false });
    expect(lines.join('\n')).toContain(drawn.join('\n'));
  });

  it('uses black on white whatever the terminal is, when colour is on', () => {
    const lines = phoneSignInLines([origins[0] as string], createSignInCodes(), { color: true });
    const qr = lines.filter((l) => l.startsWith('\u001b[38;5;16;48;5;231m'));
    expect(qr.length).toBeGreaterThan(20);
    expect(plain(lines.join('\n'))).not.toContain('\u001b');
  });

  it('prints nothing with no address', () => {
    expect(phoneSignInLines([], createSignInCodes(), { color: true })).toEqual([]);
  });

  it('falls back to the link alone when a link is too long for a code', () => {
    expect(qrLines(`http://x/#${'a'.repeat(400)}`, false)).toEqual([]);
  });

  it('fits the real link, 43-character code and all, in one code of version 6 or less', () => {
    const codes = createSignInCodes();
    const link = signInLinkAt('http://192.168.100.200:7790', codes.mint());
    expect(link.length).toBeGreaterThan(80);
    expect(encodeQr(link).version).toBeLessThanOrEqual(6);
  });
});

// ---- attacks on the exchange route, with the Host a phone sends

const LAN = '192.168.1.20';
let home: string;
let open: ServeListening[] = [];
let logs: string[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-phone-'));
  makeServeToken(home);
  logs = [];
});
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  rmSync(home, { recursive: true, force: true });
});

async function startLan(codes = createSignInCodes()) {
  const store = new MemoryEventStore();
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient([]),
    tools: new ToolRegistry([finish]),
    capabilities: () => ({}) as never,
    leaseMs: 300,
    sleep: async () => {},
  });
  const s = await listenServe(
    {
      store,
      runtime,
      home,
      version: '9.9.9',
      config: () => ({
        model: 'scripted',
        permissions: { autoApprove: ['read'] },
        budget: DEFAULT_BUDGET,
        workspaceDir: '/w',
      }),
      tokenHash: () => serveTokenHash(home),
      sessionHashes: () => sessionHashes(home),
      signIn: { codes, session: () => makeSession(home) },
      allowedHosts: [LAN],
      log: (line) => logs.push(line),
    },
    { host: '127.0.0.1', port: 0 },
  );
  open.push(s);
  return { s, codes };
}

/** What a phone's browser sends from the page at http://LAN:port, unless a header is overridden. */
function exchange(port: number, code: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/session/exchange',
        method: 'POST',
        headers: {
          host: `${LAN}:${port}`,
          origin: `http://${LAN}:${port}`,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    r.on('error', reject);
    r.end(JSON.stringify({ code }));
  });
}

describe('the exchange from a phone on the LAN', () => {
  it('passes the Host and Origin checks with the LAN address, and gives a session', async () => {
    const { s, codes } = await startLan();
    const r = await exchange(s.port, codes.mint({ keep: true }));
    expect(r.status).toBe(200);
    const session = (JSON.parse(r.body) as { token: string }).token;
    expect(sessionHashes(home)).toContain(sha256Hex(session));
  });

  it('works once: the same link a second time is refused', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    expect((await exchange(s.port, code)).status).toBe(200);
    expect((await exchange(s.port, code)).status).toBe(401);
  });

  it('refuses a code after ten minutes', async () => {
    let t = 0;
    const { s, codes } = await startLan(createSignInCodes(() => t));
    const code = codes.mint({ keep: true });
    t += SIGN_IN_CODE_TTL_MS + 1;
    expect((await exchange(s.port, code)).status).toBe(401);
    t = 0; // even if the clock went back, an expired code is used up
    expect((await exchange(s.port, code)).status).toBe(401);
  });

  it('refuses a wrong code, and five wrong ones lock the address out, the right code too', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    for (let i = 0; i < 5; i++) expect((await exchange(s.port, `wrong-${i}`)).status).toBe(401);
    expect((await exchange(s.port, code)).status).toBe(429);
  });

  it('refuses a page on another site, and that does not spend the code or count as a failure', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    for (let i = 0; i < 8; i++) {
      expect((await exchange(s.port, code, { origin: 'http://evil.example' })).status).toBe(403);
      expect((await exchange(s.port, code, { origin: 'null' })).status).toBe(403);
      expect((await exchange(s.port, code, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    }
    // an Origin on the same host but another port is another site too
    expect((await exchange(s.port, code, { origin: `http://${LAN}:${s.port + 1}` })).status).toBe(
      403,
    );
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('refuses a Host it does not know (DNS rebinding), without spending the code', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    for (const host of [
      'evil.example',
      `evil.example:${s.port}`,
      `192.168.1.21:${s.port}`,
      `${LAN}.evil.example`,
      `0.0.0.0:${s.port}`,
    ]) {
      const r = await exchange(s.port, code, { host, origin: `http://${host}` });
      expect([host, r.status]).toEqual([host, 421]);
    }
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('refuses a request with no Host header at all', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    const reply = await new Promise<string>((resolve, reject) => {
      const sock = connect(s.port, '127.0.0.1');
      let text = '';
      sock.on('data', (c) => {
        text += c;
      });
      sock.on('close', () => resolve(text));
      sock.on('error', reject);
      const body = JSON.stringify({ code });
      sock.write(
        `POST /api/session/exchange HTTP/1.0\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
      );
    });
    expect(reply).toMatch(/^HTTP\/1\.[01] 421/);
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('keeps the code out of the request line and the log', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    await exchange(s.port, code);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toContain(code);
    expect(logs.join('\n')).toContain('POST /api/session/exchange 200');
  });

  it('never writes the code to a file in the home folder', async () => {
    const { s, codes } = await startLan();
    const code = codes.mint({ keep: true });
    await exchange(s.port, code);
    for (const f of readdirSync(home)) {
      expect(readFileSync(join(home, f), 'utf8'), f).not.toContain(code);
    }
  });
});

// ---- `remy serve --host 0.0.0.0` on a terminal, through the real command

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'),
  )?.address;

describe('remy serve on every interface', () => {
  const boot = async (extra: Partial<CliDeps>, env: Record<string, string> = {}) => {
    let stop: () => void = () => {};
    const serveStop = new Promise<void>((r) => {
      stop = r;
    });
    const o = { out: '' };
    const deps: CliDeps = {
      env: { REMY_HOME: home, REMY_KEYCHAIN: 'off', ...env },
      cwd: home,
      out: (s) => {
        o.out += s.endsWith('\n') ? s : `${s}\n`;
      },
      err: () => {},
      isTTY: false,
      store: new MemoryEventStore(),
      model: new ScriptedModelClient([]),
      serveStop,
      ...extra,
    };
    const running = cli(['serve', '--host', '0.0.0.0', '--port', '0'], deps);
    for (let i = 0; i < 300 && !/listens on/.test(o.out); i++)
      await new Promise((r) => setTimeout(r, 10));
    const port = Number(/listens on http:\/\/0\.0\.0\.0:(\d+)/.exec(o.out)?.[1]);
    return {
      o,
      port,
      stop: async () => {
        stop();
        return running;
      },
    };
  };
  const remote = { REMY_SERVE_ALLOW_REMOTE: 'on' };

  it('refuses the address without the remote switch', async () => {
    const o = { out: '', err: '' };
    const deps: CliDeps = {
      env: { REMY_HOME: home, REMY_KEYCHAIN: 'off' },
      cwd: home,
      out: (s) => {
        o.out += s;
      },
      err: (s) => {
        o.err += s;
      },
      isTTY: true,
      store: new MemoryEventStore(),
      model: new ScriptedModelClient([]),
    };
    expect(await cli(['serve', '--host', '0.0.0.0'], deps)).toBe(1);
    expect(o.err).toMatch(/refused/);
    expect(o.out).not.toContain('sign-in');
  });

  it.skipIf(!lanAddress)(
    'prints a QR code and a one-time link for the LAN address on a terminal; the phone signs in from that address',
    async () => {
      const { o, port, stop } = await boot({ isTTY: true }, remote);
      const out = plain(o.out);
      expect(out).toContain(`On this network, open http://${lanAddress}:${port}`);
      expect(out).toContain('scan this with its camera');
      expect(out).toContain(NETWORK_WARNING);
      const link = new RegExp(
        `Or open: http://${(lanAddress as string).replaceAll('.', '\\.')}:${port}/#/sign-in\\?code=([\\w-]+)`,
      ).exec(out);
      const code = link?.[1] as string;
      expect(code).toBeTruthy();
      expect(o.out).toContain('█'); // a drawn code, not only text
      // From the LAN address, as the phone would: Host and Origin are the LAN address.
      const r = await fetch(`http://${lanAddress}:${port}/api/session/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(r.status).toBe(200);
      const again = await fetch(`http://${lanAddress}:${port}/api/session/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(again.status).toBe(401);
      // the code is on the terminal only: not in any file under the home folder
      for (const f of readdirSync(home))
        if (!f.endsWith('.db') && !f.includes('wal') && !f.includes('shm'))
          expect(readFileSync(join(home, f), 'utf8').includes(code), f).toBe(false);
      await stop();
    },
    15_000,
  );

  it('prints no code and no link where the output may be kept', async () => {
    const { o, port, stop } = await boot({ isTTY: false }, remote);
    expect(o.out).not.toContain('sign-in');
    expect(o.out).not.toContain('code=');
    expect(o.out).not.toContain('█');
    const r = await fetch(`http://127.0.0.1:${port}/api/session/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'anything' }),
    });
    expect(r.status).toBe(401);
    await stop();
  }, 15_000);
});
