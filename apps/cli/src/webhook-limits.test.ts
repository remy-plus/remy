import { createServer, type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { type BodyResult, createRunGate, readBody } from './webhook-limits.ts';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.closeAllConnections();
  for (const s of servers) s.close();
});

/** Sends `parts` to a server that runs readBody; `stall` leaves the request open. */
async function send(
  parts: string[],
  opts: { max?: number; timeout?: number; stall?: boolean } = {},
): Promise<BodyResult> {
  let got!: (r: BodyResult) => void;
  const result = new Promise<BodyResult>((r) => {
    got = r;
  });
  const server = createServer(async (req: IncomingMessage, res) => {
    got(await readBody(req, opts.max, opts.timeout));
    res.end();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const req = request({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    method: 'POST',
    headers: opts.stall ? { 'content-length': '1000' } : {},
  });
  req.on('error', () => {});
  for (const p of parts) req.write(p);
  if (!opts.stall) req.end();
  const r = await result;
  req.destroy();
  server.closeAllConnections();
  return r;
}

describe('readBody', () => {
  it('reads a small body', async () => {
    expect(await send(['he', 'llo'])).toEqual({ ok: true, text: 'hello' });
  });
  it('refuses a body over the limit with 413', async () => {
    const r = await send(['x'.repeat(200)], { max: 100 });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
  it('refuses a streamed body that grows past the limit', async () => {
    const r = await send(['x'.repeat(60), 'x'.repeat(60)], { max: 100 });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
  it('times out a slow sender with 408', async () => {
    const r = await send(['partial'], { stall: true, timeout: 50 });
    expect(r).toMatchObject({ ok: false, status: 408 });
  });
});

describe('run gate', () => {
  it('allows one start per hook per 10 seconds', () => {
    let t = 0;
    const g = createRunGate(() => t);
    expect(g.reserve('a', 0)).toBe('ok');
    t = 9_999;
    expect(g.reserve('a', 0)).toBe('too_soon');
    expect(g.reserve('b', 0)).toBe('ok');
    t = 10_000;
    expect(g.reserve('a', 0)).toBe('ok');
  });
  it('allows at most 3 running at once', () => {
    const g = createRunGate(() => 0);
    expect(g.reserve('a', 2)).toBe('ok');
    expect(g.reserve('b', 3)).toBe('too_many');
  });
  it('a released slot can be taken again', () => {
    const g = createRunGate(() => 0);
    g.reserve('a', 0);
    g.release('a');
    expect(g.reserve('a', 0)).toBe('ok');
  });
});
