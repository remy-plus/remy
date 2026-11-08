import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, isLoopback, resolveBind } from './webhook-bind.ts';

describe('resolveBind', () => {
  it('defaults to 127.0.0.1', () => {
    expect(resolveBind({}, {})).toEqual({ host: '127.0.0.1', port: DEFAULT_PORT });
  });
  it('accepts loopback addresses', () => {
    for (const h of ['127.0.0.1', '127.0.0.2', '::1', 'localhost'])
      expect(resolveBind({ bind: h }, {}).host).toBe(h);
  });
  it('refuses any other address without the remote flag', () => {
    for (const h of ['0.0.0.0', '::', '192.168.1.5', '100.64.0.1', 'example.com'])
      expect(() => resolveBind({ bind: h }, {})).toThrow(/Tailscale/);
    expect(() => resolveBind({ bind: '0.0.0.0' }, { REMY_WEBHOOK_ALLOW_REMOTE: 'yes' })).toThrow();
  });
  it('allows another address with REMY_WEBHOOK_ALLOW_REMOTE=on', () => {
    expect(resolveBind({ bind: '100.64.0.1' }, { REMY_WEBHOOK_ALLOW_REMOTE: 'on' }).host).toBe(
      '100.64.0.1',
    );
  });
  it('reads and checks the port', () => {
    expect(resolveBind({}, { REMY_WEBHOOK_PORT: '9000' }).port).toBe(9000);
    expect(resolveBind({ port: '0' }, {}).port).toBe(0);
    expect(() => resolveBind({ port: 'x' }, {})).toThrow();
    expect(() => resolveBind({ port: '70000' }, {})).toThrow();
  });
  it('isLoopback is exact', () => {
    expect(isLoopback('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopback('0.0.0.0')).toBe(false);
  });
});
