import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, ToolRegistry, toolSpec } from './registry.ts';

const base = defineTool({
  name: 'read_file',
  description: 'Read a file',
  args: z.object({ path: z.string().describe('Relative path') }),
  risk: 'read',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 1000,
  maxOutputChars: 1000,
  preview: (a) => `Read ${a.path}`,
  execute: async () => ({ ok: true, content: '', trust: 'trusted' }),
});

describe('ToolRegistry', () => {
  it('produces a JSON Schema spec', () => {
    expect(toolSpec(base)).toEqual({
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative path' } },
        required: ['path'],
        additionalProperties: false,
      },
    });
  });

  it('rejects bad definitions', () => {
    expect(() => new ToolRegistry([base, base])).toThrow(/duplicate/);
    expect(() => new ToolRegistry([{ ...base, name: 'Bad-Name' }])).toThrow(/name/);
    expect(() => new ToolRegistry([{ ...base, risk: 'meh' as never }])).toThrow(/risk/);
    expect(() => new ToolRegistry([{ ...base, effect: 'reconcilable' }])).toThrow(/reconcile/);
  });

  it('filters specs by name', () => {
    const r = new ToolRegistry([base, { ...base, name: 'other' }]);
    expect(r.specs(['other']).map((s) => s.name)).toEqual(['other']);
    expect(r.get('read_file')).toBe(base);
  });
});
