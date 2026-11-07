import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHelperRoles } from './helper-roles.ts';

const dirs = () => {
  const root = mkdtempSync(join(tmpdir(), 'remy-roles-'));
  const home = join(root, 'home');
  const cwd = join(root, 'proj');
  mkdirSync(home);
  mkdirSync(join(cwd, '.remy'), { recursive: true });
  return { home, cwd };
};

describe('loadHelperRoles', () => {
  it('has the built-ins with no files', () => {
    const { home, cwd } = dirs();
    const r = loadHelperRoles(home, cwd);
    expect(r.roles.map((x) => x.name).sort()).toEqual(['checker', 'researcher']);
    expect(r.problems).toEqual([]);
  });

  it('lets the project win and marks its source', () => {
    const { home, cwd } = dirs();
    writeFileSync(join(home, 'helpers.md'), '## scout\nUser scout.\n## researcher\nUser.\n');
    writeFileSync(join(cwd, '.remy', 'helpers.md'), '## scout\nProject scout.\n');
    const r = loadHelperRoles(home, cwd);
    expect(r.roles.find((x) => x.name === 'scout')).toMatchObject({
      source: 'project',
      instructions: 'Project scout.',
    });
    expect(r.roles.find((x) => x.name === 'researcher')?.source).toBe('user');
  });

  it('reports bad input with the file, and does not throw on an unreadable path', () => {
    const { home, cwd } = dirs();
    writeFileSync(join(home, 'helpers.md'), '## bad name!\nx\n');
    mkdirSync(join(cwd, '.remy', 'helpers.md'));
    const r = loadHelperRoles(home, cwd);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain('helpers.md, line 1');
    expect(r.problems[1]).toContain('could not be read');
  });
});
