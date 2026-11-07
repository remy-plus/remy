import { describe, expect, it } from 'vitest';
import { BUILTIN_ROLES, mergeRoles, parseRoles } from './roles.ts';

describe('parseRoles', () => {
  it('reads tools, act and instructions', () => {
    const { roles, problems } = parseRoles(
      '# Helpers\n\n## Scout\nTools: fetch_url, web_search\nAct: no\n\nLook things up.\nBe brief.\n\n## filer\nAct: yes\nFile the result.\n',
      'user',
    );
    expect(problems).toEqual([]);
    expect(roles).toEqual([
      {
        name: 'scout',
        tools: ['fetch_url', 'web_search'],
        act: false,
        source: 'user',
        instructions: 'Look things up.\nBe brief.',
      },
      { name: 'filer', act: true, source: 'user', instructions: 'File the result.' },
    ]);
  });

  it('never throws, and says what is wrong with a line number', () => {
    const { roles, problems } = parseRoles(
      'stray\n## bad name!\nx\n## empty\nTools: a\n## a\nAct: maybe\ntext\n## b\nTools:\ntext\n## ok\nfine\n## ok\nagain\n',
      'project',
    );
    expect(roles.map((r) => r.name)).toEqual(['ok']);
    expect(problems).toHaveLength(6);
    expect(problems.join('\n')).toMatch(/line 1: text before/);
    expect(problems.join('\n')).toMatch(/line 2: "bad name!" is not a role name/);
    expect(problems.join('\n')).toMatch(/line 4: role "empty" has no instructions/);
    expect(problems.join('\n')).toMatch(/Act must be yes or no/);
    expect(problems.join('\n')).toMatch(/empty Tools line/);
    expect(problems.join('\n')).toMatch(/appears twice/);
  });

  it('handles empty, binary-ish and huge input', () => {
    expect(parseRoles('', 'user')).toEqual({ roles: [], problems: [] });
    expect(() => parseRoles('\u0000\u0001\r\n## \n##', 'user')).not.toThrow();
    const big = parseRoles(`## big\n${'x'.repeat(5000)}`, 'user');
    expect(big.roles[0]?.instructions).toHaveLength(2000);
    expect(big.problems).toHaveLength(1);
  });

  it('does not read Tools or Act lines inside the instructions', () => {
    const { roles } = parseRoles('## r\nDo it.\nTools: everything\n', 'user');
    expect(roles[0]?.tools).toBeUndefined();
    expect(roles[0]?.instructions).toContain('Tools: everything');
  });
});

describe('mergeRoles', () => {
  it('lets the project win by name', () => {
    const project = parseRoles('## researcher\nMine.\n', 'project').roles;
    const merged = mergeRoles(BUILTIN_ROLES, [], project);
    expect(merged.find((r) => r.name === 'researcher')?.source).toBe('project');
    expect(merged.map((r) => r.name)).toContain('checker');
  });
});
