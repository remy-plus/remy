// Loads helper roles: the built-ins, then REMY_HOME/helpers.md, then .remy/helpers.md in the
// project (which wins by name). A file that cannot be read or parsed gives a problem line for
// `remy doctor`; it never stops Remy.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_ROLES, type HelperRole, mergeRoles, parseRoles } from '@remy/core';

export interface LoadedRoles {
  roles: HelperRole[];
  problems: string[];
}

function readRoles(file: string, source: 'user' | 'project') {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? { roles: [], problems: [] }
      : { roles: [], problems: [`${file}: could not be read (${(e as Error).message}).`] };
  }
  const parsed = parseRoles(text, source);
  return { roles: parsed.roles, problems: parsed.problems.map((p) => `${file}, ${p}`) };
}

export function loadHelperRoles(home: string, cwd: string): LoadedRoles {
  const user = readRoles(join(home, 'helpers.md'), 'user');
  const project = readRoles(join(cwd, '.remy', 'helpers.md'), 'project');
  return {
    roles: mergeRoles(BUILTIN_ROLES, user.roles, project.roles),
    problems: [...user.problems, ...project.problems],
  };
}
