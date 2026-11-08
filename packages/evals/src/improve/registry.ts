// Which prompt text `remy improve` may change. Everything not listed as editable here is locked.
import { SYSTEM_PARTS, type Tool } from '@remy/core';
import * as tools from '@remy/tools';
import { BUILTIN_SKILLS, type Skill } from '@remy/tools';

export type PromptKind = 'system' | 'tool' | 'skill';

export interface PromptEntry {
  /** `system:<part>`, `tool:<name>` or `skill:<name>`. */
  id: string;
  kind: PromptKind;
  text: string;
  editable: boolean;
  /** Repo-relative file that holds the text, for the entries that may be edited. */
  file?: string;
}

/** Id to new text. Applied in memory for a check, written to source only by `remy improve apply`. */
export type PromptOverrides = Readonly<Record<string, string>>;

/** Tool descriptions that may be tuned: plain, low-risk ones with no safety wording. */
export const EDITABLE_TOOLS: Readonly<Record<string, string>> = {
  read_file: 'packages/tools/src/file-tools.ts',
  list_files: 'packages/tools/src/file-tools.ts',
  finish: 'packages/tools/src/file-tools.ts',
  calculate: 'packages/tools/src/calc-tools.ts',
  update_plan: 'packages/tools/src/plan-tool.ts',
  ask_user: 'packages/tools/src/web.ts',
};

/** Built-in skill descriptions that may be tuned. Skills that send, spend or buy stay locked. */
export const EDITABLE_SKILLS: readonly string[] = ['research', 'triage-issues', 'save-to-notion'];

const SYSTEM_FILE = 'packages/core/src/messages.ts';
const SKILLS_FILE = 'packages/tools/src/builtin-skills.ts';

const isTool = (x: unknown): x is Tool =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Tool).name === 'string' &&
  typeof (x as Tool).description === 'string' &&
  typeof (x as Tool).execute === 'function';

/** Every prompt text we know of, editable or not. */
export function promptRegistry(): PromptEntry[] {
  const out: PromptEntry[] = SYSTEM_PARTS.map((p) => ({
    id: `system:${p.id}`,
    kind: 'system',
    text: p.text,
    editable: p.editable,
    ...(p.editable && { file: SYSTEM_FILE }),
  }));
  for (const t of Object.values(tools).filter(isTool)) {
    const file = EDITABLE_TOOLS[t.name];
    out.push({
      id: `tool:${t.name}`,
      kind: 'tool',
      text: t.description,
      editable: file !== undefined,
      ...(file && { file }),
    });
  }
  for (const s of BUILTIN_SKILLS) {
    const editable = EDITABLE_SKILLS.includes(s.name);
    out.push({
      id: `skill:${s.name}`,
      kind: 'skill',
      text: s.description,
      editable,
      ...(editable && { file: SKILLS_FILE }),
    });
  }
  return out;
}

export const editableEntries = (): PromptEntry[] => promptRegistry().filter((e) => e.editable);

/** Tools with their descriptions replaced by id. */
export function overrideTools(list: Tool[], o: PromptOverrides): Tool[] {
  return list.map((t) => {
    const d = o[`tool:${t.name}`];
    return d === undefined ? t : { ...t, description: d };
  });
}

export function overrideSkills(list: Skill[], o: PromptOverrides): Skill[] {
  return list.map((s) => {
    const d = o[`skill:${s.name}`];
    return d === undefined ? s : { ...s, description: d };
  });
}
