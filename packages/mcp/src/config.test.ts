import { describe, expect, it } from 'vitest';
import { isStdio, mcpServerConfigSchema, mcpServersSchema } from './config.ts';

describe('mcp server config', () => {
  it('accepts a stdio server', () => {
    const c = mcpServerConfigSchema.parse({ command: 'npx', args: ['-y', 'x'], env: { A: '1' } });
    expect(isStdio(c)).toBe(true);
  });

  it('accepts a streamable HTTP server with headers', () => {
    const c = mcpServerConfigSchema.parse({
      url: 'https://mcp.example.com/mcp',
      headers: { a: 'b' },
    });
    expect(isStdio(c)).toBe(false);
  });

  it('accepts trustHints, enabled, timeout and tool overrides', () => {
    const c = mcpServerConfigSchema.parse({
      command: 'x',
      trustHints: true,
      enabled: false,
      timeoutMs: 5000,
      tools: { a: { risk: 'write', effect: 'idempotent' }, b: { disabled: true } },
    });
    expect(c.tools?.a?.risk).toBe('write');
  });

  it('ignores unknown keys such as Claude Desktop "type"', () => {
    expect(() => mcpServerConfigSchema.parse({ type: 'stdio', command: 'x' })).not.toThrow();
  });

  it.each([
    ['neither command nor url', {}],
    ['both command and url', { command: 'x', url: 'https://a.example' }],
    ['a non-http url', { url: 'ftp://a.example' }],
    ['an empty command', { command: '' }],
    ['an unknown risk', { command: 'x', tools: { a: { risk: 'yolo' } } }],
    ['a reconcilable override', { command: 'x', tools: { a: { effect: 'reconcilable' } } }],
    ['non-string env', { command: 'x', env: { A: 1 } }],
  ])('rejects %s', (_, input) => {
    expect(mcpServerConfigSchema.safeParse(input).success).toBe(false);
  });

  it('parses a map of servers', () => {
    const servers = mcpServersSchema.parse({
      a: { command: 'x' },
      b: { url: 'http://localhost:1/mcp' },
    });
    expect(Object.keys(servers)).toEqual(['a', 'b']);
  });
});
