// The skill store: yours in REMY_HOME/skills/<name>/SKILL.md, a project's in .remy/skills/ under
// the folder Remy started in, and the built-ins. Every list() reads the folders again, so a skill
// added in another window shows up on the next message. A skill that does not parse is skipped
// and reported by `remy skills list`, never fatal.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  BUILTIN_SKILLS,
  mergeSkills,
  parseSkill,
  SKILL_BODY_MAX,
  type Skill,
  type SkillDraft,
  type SkillSource,
  type SkillsPort,
  skillText,
} from '@remy/tools';

import type { SkillOrigin } from './skills-web.ts';

export interface SkillProblem {
  path: string;
  error: string;
}

export interface SkillCandidate {
  skill: Skill;
  /** The SKILL.md text as it will be saved. */
  text: string;
  /** Other files in the folder, which are not copied (skills are instructions only). */
  skipped: string[];
  /** A skill of yours with this name is replaced. */
  replaces: boolean;
  /** Where it came from, for a skill added from a link. */
  origin?: SkillOrigin;
}

export interface SkillStore extends SkillsPort {
  /** Every skill, switched-off ones included. `list` leaves those out: Remy never sees them. */
  all(): Skill[];
  /** Names switched off with `setEnabled`. */
  disabled(): string[];
  /** Switches a skill off or on for Remy (nothing is deleted). False when no skill has that name. */
  setEnabled(name: string, enabled: boolean): boolean;
  save(draft: SkillDraft): { path: string };
  used(name: string): void;
  /** Skills that could not be read, with why. */
  problems(): SkillProblem[];
  /** Reads a folder (or a SKILL.md) to show the user before `install`. Throws with a plain reason. */
  prepare(path: string): SkillCandidate;
  /** The same for text fetched from a link. */
  prepareWeb(text: string, origin: SkillOrigin): SkillCandidate;
  /** Where a skill from the web came from, and its text as saved. */
  web(name: string): { origin: SkillOrigin; text: string } | undefined;
  install(c: SkillCandidate): string;
  /** Removes one of yours. False when you have no skill of that name. */
  remove(name: string): boolean;
}

const SKILL_FILE = 'SKILL.md';

function readDir(dir: string, source: SkillSource, problems: SkillProblem[]): Skill[] {
  if (!existsSync(dir)) return [];
  const out: Skill[] = [];
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  for (const folder of names) {
    const path = join(dir, folder, SKILL_FILE);
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (e) {
      problems.push({ path, error: (e as Error).message });
      continue;
    }
    const r = parseSkill(text, folder);
    if (!r.ok) {
      problems.push({ path, error: r.error });
      continue;
    }
    out.push({ ...r.skill, body: r.skill.body.slice(0, SKILL_BODY_MAX), source, path });
  }
  return out;
}

export function openSkills(home: string, cwd: string): SkillStore {
  const mine = join(home, 'skills');
  const projectDir = resolve(cwd, '.remy', 'skills');
  const project = resolve(projectDir) === resolve(mine) ? undefined : projectDir;
  const usesPath = join(mine, '.uses.json');
  const sourcesPath = join(mine, '.sources.json');
  const loadSources = (): Record<string, SkillOrigin> => {
    try {
      const raw = JSON.parse(readFileSync(sourcesPath, 'utf8')) as unknown;
      return raw && typeof raw === 'object' ? (raw as Record<string, SkillOrigin>) : {};
    } catch {
      return {};
    }
  };
  const saveSources = (sources: Record<string, SkillOrigin>) => {
    mkdirSync(mine, { recursive: true });
    writeFileSync(sourcesPath, JSON.stringify(sources, null, 2));
  };
  const offPath = join(mine, '.disabled.json');
  const loadOff = (): string[] => {
    try {
      const raw = JSON.parse(readFileSync(offPath, 'utf8')) as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const loadUses = (): Record<string, number> => {
    try {
      const raw = JSON.parse(readFileSync(usesPath, 'utf8')) as unknown;
      return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
    } catch {
      return {};
    }
  };
  const read = () => {
    const problems: SkillProblem[] = [];
    const uses = loadUses();
    const withUses = (list: Skill[]) =>
      list.map((k) => (typeof uses[k.name] === 'number' ? { ...k, uses: uses[k.name] } : k));
    const sources = loadSources();
    const merged = mergeSkills(
      readDir(mine, 'yours', problems).map((k) =>
        sources[k.name] ? { ...k, source: 'web' as const } : k,
      ),
      project ? readDir(project, 'project', problems) : [],
      BUILTIN_SKILLS,
    );
    return { skills: withUses(merged), problems };
  };
  return {
    list: () => {
      const off = new Set(loadOff());
      return read().skills.filter((k) => !off.has(k.name));
    },
    all: () => read().skills,
    disabled: loadOff,
    setEnabled(name, enabled) {
      if (!read().skills.some((k) => k.name === name)) return false;
      const rest = loadOff().filter((n) => n !== name);
      mkdirSync(mine, { recursive: true });
      writeFileSync(offPath, JSON.stringify(enabled ? rest : [...rest, name]));
      return true;
    },
    problems: () => read().problems,
    prepare(path) {
      const abs = resolve(cwd, path);
      if (!existsSync(abs)) throw new Error(`${abs} does not exist.`);
      const isDir = statSync(abs).isDirectory();
      const file = isDir ? join(abs, SKILL_FILE) : abs;
      if (!existsSync(file)) throw new Error(`There is no ${SKILL_FILE} in ${abs}.`);
      const text = readFileSync(file, 'utf8');
      const folder = basename(isDir ? abs : dirname(abs));
      const r = parseSkill(text, folder);
      if (!r.ok) throw new Error(`${file}: ${r.error}`);
      if (r.skill.body.length > SKILL_BODY_MAX)
        throw new Error(
          `${file} is over ${SKILL_BODY_MAX.toLocaleString('en-US')} characters. Shorten it first.`,
        );
      const root = isDir ? abs : dirname(abs);
      const skipped = readdirSync(root).filter((n) => n !== SKILL_FILE && !n.startsWith('.'));
      return {
        skill: { ...r.skill, source: 'yours' },
        text,
        skipped: isDir ? skipped : [],
        replaces: existsSync(join(mine, r.skill.name, SKILL_FILE)),
      };
    },
    prepareWeb(text, origin) {
      const r = parseSkill(text);
      if (!r.ok) throw new Error(`${origin.url}: ${r.error}`);
      if (r.skill.body.length > SKILL_BODY_MAX)
        throw new Error(
          `${origin.url} is over ${SKILL_BODY_MAX.toLocaleString('en-US')} characters.`,
        );
      return {
        skill: { ...r.skill, source: 'web' },
        text,
        skipped: [],
        replaces: existsSync(join(mine, r.skill.name, SKILL_FILE)),
        origin,
      };
    },
    web(name) {
      const origin = loadSources()[name];
      const path = join(mine, name, SKILL_FILE);
      if (!origin || !existsSync(path)) return undefined;
      return { origin, text: readFileSync(path, 'utf8') };
    },
    install(c) {
      const dir = join(mine, c.skill.name);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, SKILL_FILE);
      writeFileSync(path, c.text);
      // A skill added from a folder replaces one from the web and is no longer marked as such.
      const { [c.skill.name]: _, ...others } = loadSources();
      saveSources(c.origin ? { ...others, [c.skill.name]: c.origin } : others);
      return path;
    },
    save(d) {
      const dir = join(mine, d.name);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, SKILL_FILE);
      writeFileSync(path, skillText(d));
      return { path };
    },
    used(name) {
      // Best effort: a lost count only changes ranking a little.
      try {
        const uses = loadUses();
        uses[name] = (uses[name] ?? 0) + 1;
        mkdirSync(mine, { recursive: true });
        writeFileSync(usesPath, JSON.stringify(uses));
      } catch {}
    },
    remove(name) {
      const dir = join(mine, name);
      if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(dir, SKILL_FILE))) return false;
      rmSync(dir, { recursive: true, force: true });
      const { [name]: _, ...others } = loadSources();
      saveSources(others);
      return true;
    },
  };
}

const SOURCE_LABEL: Record<SkillSource, string> = {
  yours: 'yours',
  project: 'this project',
  builtin: 'built in',
  web: 'from the web',
};

const firstSentence = (t: string) => t.split(/(?<=[.!?])\s/)[0] ?? t;

/** The plain list for `remy skills list` and `/skills`. */
export function plainSkills(
  skills: Skill[],
  problems: SkillProblem[] = [],
  off: string[] = [],
): string {
  const lines = skills.length ? [] : ['No skills yet.'];
  for (const source of ['yours', 'web', 'project', 'builtin'] as const) {
    const group = skills.filter((s) => s.source === source);
    if (!group.length) continue;
    if (lines.length) lines.push('');
    lines.push(`Skills (${SOURCE_LABEL[source]})`);
    for (const s of group)
      lines.push(
        `  ${s.name.padEnd(20)} ${off.includes(s.name) ? '[off] ' : ''}${s.learned ? '[learned] ' : ''}${firstSentence(s.description)}`,
      );
  }
  for (const p of problems) lines.push('', `Skipped ${p.path}: ${p.error}`);
  lines.push(
    '',
    'Add your own with remy skills add <folder>; see one with remy skills show <name>.',
    ...(skills.some((s) => s.learned)
      ? [
          '[learned] ones were saved from your corrections. Edit the file shown by show, or remove one with remy skills rm <name>.',
        ]
      : []),
  );
  return lines.join('\n');
}

/** The full text for `remy skills show` and the add preview. */
export function plainSkill(s: Skill): string {
  return [
    `${s.name} (${SOURCE_LABEL[s.source]}${s.learned ? ', learned from a correction' : ''})`,
    s.description,
    ...(s.tools.length ? [`Tools it expects: ${s.tools.join(', ')}`] : []),
    ...(s.path ? [s.path] : []),
    '',
    s.body,
  ].join('\n');
}
