// `remy serve` routes for skills: what the web app's Skills screen calls.
//
//   GET  /api/skills               every skill, with its steps, and { suggestion: null }
//   GET  /api/skills/:name         one skill with its full text
//   POST /api/skills/:name/enabled {enabled}   switch it off or on for Remy (nothing is deleted)
//   POST /api/skills/:name/run     start a task that uses the skill -> { taskId }
//   GET  /api/skills/directory?q=&from=skills|bots   find skills on skills.sh or botdirectory.ai
//   POST /api/skills/directory/install {source, id}  the person installs one (text only)
//
// There is no source of "save this as a skill?" suggestions in the CLI (a correction saves a
// how-to on its own), so the list always says `suggestion: null` and there are no suggestion
// routes. A skill is text only: running one starts an ordinary task that is told to use it, with
// ordinary approvals; the skill grants nothing. Skills from a project folder or a link were never
// reviewed, so reading one taints the task exactly as it does in the terminal.
import type { Skill } from '@remy/tools';
import { z } from 'zod';
import {
  guard,
  HttpFail,
  idOf,
  jsonBody,
  type Mount,
  methodNotAllowed,
  ok,
} from './serve-mount.ts';
import type { SkillStore } from './skills.ts';
import {
  DIRECTORY_NOTE,
  DirectoryError,
  type DirectoryResult,
  prepareFromDirectory,
  searchBots,
  searchSkillsSh,
} from './skills-directory.ts';

export interface SkillsMountDeps {
  skills: Pick<SkillStore, 'all' | 'disabled' | 'setEnabled' | 'web' | 'prepareWeb' | 'install'>;
  /** For the two directories and GitHub; tests pass a fake. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

const installBody = z
  .object({ source: z.enum(['skills.sh', 'botdirectory']), id: z.string().min(1).max(200) })
  .strict();
const DIRECTORY_TTL_MS = 60_000;

const enabledBody = z.object({ enabled: z.boolean() }).strict();
const STEP_CHARS = 160;
const STEPS_MAX = 30;

const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** The numbered or bulleted lines of a skill's body, one step each. Text only. */
export function stepsOf(body: string): { title: string; detail: string }[] {
  const steps: { title: string; detail: string }[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) steps.push({ title: clip(m[1], STEP_CHARS), detail: '' });
    if (steps.length >= STEPS_MAX) break;
  }
  return steps;
}

export function createSkillsMount(deps: SkillsMountDeps): Mount {
  const { skills } = deps;

  const item = (s: Skill, off: Set<string>) => {
    const web = s.source === 'web' ? skills.web(s.name) : undefined;
    const source: 'yours' | 'learned' | 'builtin' =
      s.source === 'builtin' ? 'builtin' : s.learned ? 'learned' : 'yours';
    const origin =
      s.source === 'web'
        ? `From a link: ${web?.origin.url ?? 'unknown'}. Not reviewed by you.`
        : s.source === 'project'
          ? "From this project's folder. Not reviewed by you."
          : s.learned
            ? 'Saved from a correction you made.'
            : null;
    return {
      name: s.name,
      blurb: s.description,
      source,
      enabled: !off.has(s.name),
      used: s.uses ?? 0,
      // The CLI does not record when a skill was last used, only how many times.
      lastRun: null,
      origin,
      steps: stepsOf(s.body),
      why: null,
    };
  };

  const find = (name: string) => {
    const s = skills.all().find((x) => x.name === name);
    if (!s) throw new HttpFail(404, 'There is no such skill.');
    return s;
  };

  const cache = new Map<string, { at: number; results: DirectoryResult[] }>();
  const plain = (e: unknown): never => {
    if (e instanceof DirectoryError) throw new HttpFail(e.status, e.message);
    throw e;
  };

  async function directory(url: URL) {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const from = url.searchParams.get('from') ?? 'skills';
    if (!q) throw new HttpFail(400, 'Type what to look for.');
    if (from !== 'skills' && from !== 'bots')
      throw new HttpFail(400, 'Choose skills or bots to look in.');
    const key = `${from}:${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < DIRECTORY_TTL_MS)
      return ok({ results: hit.results, note: DIRECTORY_NOTE });
    const opts = { limit: 20, ...(deps.fetch && { fetch: deps.fetch }) };
    let results: DirectoryResult[];
    try {
      results = from === 'bots' ? await searchBots(q, opts) : await searchSkillsSh(q, opts);
    } catch (e) {
      return plain(e);
    }
    cache.set(key, { at: Date.now(), results });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    return ok({ results, note: DIRECTORY_NOTE });
  }

  async function install(req: import('node:http').IncomingMessage) {
    const b = await jsonBody(req, installBody);
    try {
      const c = await prepareFromDirectory(b.source, b.id, {
        skills,
        ...(deps.fetch && { fetch: deps.fetch }),
      });
      skills.install(c);
      const saved = skills.all().find((x) => x.name === c.skill.name);
      if (!saved) throw new HttpFail(502, 'The skill was saved but could not be read back.');
      return ok({ skill: item(saved, new Set(skills.disabled())) }, 201);
    } catch (e) {
      return plain(e);
    }
  }

  return guard(async ({ req, method, parts, url, startTask }) => {
    const [head, name, action] = parts;
    if (head !== 'skills' || parts.length > 3) return undefined;
    if (name === 'directory' && parts.length === 2) {
      if (method !== 'GET') return methodNotAllowed('GET');
      return directory(url);
    }
    if (name === 'directory' && action === 'install') {
      if (method !== 'POST') return methodNotAllowed('POST');
      return install(req);
    }
    if (parts.length === 1) {
      if (method !== 'GET') return methodNotAllowed('GET');
      const off = new Set(skills.disabled());
      return ok({ skills: skills.all().map((s) => item(s, off)), suggestion: null });
    }
    const id = idOf(name);
    if (parts.length === 2) {
      if (method !== 'GET') return methodNotAllowed('GET');
      const s = find(id);
      return ok({
        ...item(s, new Set(skills.disabled())),
        body: s.body,
        tools: s.tools,
        connections: s.connections ?? [],
      });
    }
    if (action === 'enabled') {
      if (method !== 'POST') return methodNotAllowed('POST');
      const b = await jsonBody(req, enabledBody);
      find(id);
      skills.setEnabled(id, b.enabled);
      return ok();
    }
    if (action === 'run') {
      if (method !== 'POST') return methodNotAllowed('POST');
      await jsonBody(req, z.object({}).strict(), true);
      find(id);
      if (skills.disabled().includes(id))
        throw new HttpFail(409, 'This skill is switched off. Switch it on to run it.');
      return ok(await startTask(`Use the ${id} skill.`), 201);
    }
    return undefined;
  });
}
