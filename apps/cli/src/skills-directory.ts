// Finding skills in two public directories, read-only, and preparing one for install. Nothing here
// is trusted: a result is text written by someone else, and it only becomes a skill after the
// person sees it and says yes (`remy skills add`, or the signed-in web route). No agent tool
// reaches this file, so a page or an email cannot install a skill. Text only, never run.
//
// Shapes read on 2026-11-12:
//   https://skills.sh/api/search?q=pdf -> { skills: [{ id: "anthropics/skills/pdf", source:
//     "anthropics/skills", skillId: "pdf", name: "pdf", installs: 227931 }], count, ... }
//   https://api.botdirectory.ai/api/bots?q=email&limit=n -> { bots: [{ slug, name, category,
//     integrations: [], prompt, detailUrl, ... }], pagination }. There is no single-bot route
//     (/api/bots/<slug> answers 404), so a bot is found again by searching its name.
import { parseSkill, SKILL_BODY_MAX, SKILL_NAME_MAX, skillText } from '@remy/tools';
import type { SkillCandidate, SkillStore } from './skills.ts';
import { fetchSkill } from './skills-web.ts';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type DirectorySource = 'skills.sh' | 'botdirectory';

export interface DirectoryResult {
  source: DirectorySource;
  id: string;
  name: string;
  description: string;
  detail: string;
  url: string;
  preview?: string;
}

export interface DirectoryOptions {
  fetch?: Fetch;
  limit?: number;
}

/** A failure with the status a web route should answer with. The message is plain English. */
export class DirectoryError extends Error {
  readonly status: 400 | 404 | 409 | 502;
  constructor(status: 400 | 404 | 409 | 502, message: string) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 8000;
const LIMIT_MAX = 20;
const PREVIEW_CHARS = 600;
const BOT_BODY_MAX = 8000;
const SKILLS_SH = 'https://skills.sh';
const BOTS_API = 'https://api.botdirectory.ai/api/bots';
const BOTS_SITE = 'https://botdirectory.ai/bots';
const SKILL_ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

export const DIRECTORY_NOTE =
  'Results come from skills.sh and botdirectory.ai, which anyone can publish to. Nothing is checked for you. An installed skill is text only: it is a guide Remy reads, never a program, and actions it suggests still need your approval.';

const clampLimit = (n: number | undefined) => Math.max(1, Math.min(LIMIT_MAX, Math.floor(n ?? 10)));

async function getJson(url: string, who: string, f: Fetch): Promise<unknown> {
  const down = `${who} could not be reached. Try again in a minute.`;
  let r: Response;
  try {
    r = await f(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DirectoryError(502, down);
  }
  if (!r.ok) throw new DirectoryError(502, `${who} answered ${r.status}. Try again in a minute.`);
  try {
    return await r.json();
  } catch {
    throw new DirectoryError(502, `${who} sent an answer Remy could not read.`);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function searchSkillsSh(
  q: string,
  opts: DirectoryOptions = {},
): Promise<DirectoryResult[]> {
  const limit = clampLimit(opts.limit);
  const body = await getJson(
    `${SKILLS_SH}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    'skills.sh',
    opts.fetch ?? fetch,
  );
  const list = isRec(body) && Array.isArray(body.skills) ? body.skills : null;
  if (!list) throw new DirectoryError(502, 'skills.sh sent an answer Remy could not read.');
  const out: DirectoryResult[] = [];
  for (const raw of list) {
    if (!isRec(raw)) continue;
    const id = str(raw.id);
    if (!SKILL_ID_RE.test(id)) continue;
    const installs = typeof raw.installs === 'number' ? raw.installs : undefined;
    out.push({
      source: 'skills.sh',
      id,
      name: str(raw.name) || (id.split('/')[2] as string),
      description: str(raw.description),
      detail: installs === undefined ? '' : `${installs.toLocaleString('en-US')} installs`,
      url: `${SKILLS_SH}/${id}`,
    });
  }
  return out.slice(0, limit);
}

function botOf(raw: unknown): (DirectoryResult & { prompt: string; category: string }) | undefined {
  if (!isRec(raw)) return undefined;
  const slug = str(raw.slug);
  const prompt = str(raw.prompt);
  if (!SLUG_RE.test(slug) || !prompt) return undefined;
  const category = str(raw.category);
  const integrations = Array.isArray(raw.integrations)
    ? raw.integrations.filter((x): x is string => typeof x === 'string' && x !== '')
    : [];
  return {
    source: 'botdirectory',
    id: slug,
    name: str(raw.name) || slug,
    description: str(raw.description),
    detail: [category, integrations.join(', ')].filter(Boolean).join(' · '),
    url: `${BOTS_SITE}/${slug}`,
    preview: prompt.slice(0, PREVIEW_CHARS),
    prompt,
    category,
  };
}

async function botsFor(q: string, limit: number, f: Fetch) {
  const body = await getJson(
    `${BOTS_API}?q=${encodeURIComponent(q)}&limit=${limit}`,
    'botdirectory.ai',
    f,
  );
  const list = isRec(body) && Array.isArray(body.bots) ? body.bots : null;
  if (!list) throw new DirectoryError(502, 'botdirectory.ai sent an answer Remy could not read.');
  return list.map(botOf).filter((b): b is NonNullable<ReturnType<typeof botOf>> => !!b);
}

export async function searchBots(
  q: string,
  opts: DirectoryOptions = {},
): Promise<DirectoryResult[]> {
  const limit = clampLimit(opts.limit);
  const found = await botsFor(q, limit, opts.fetch ?? fetch);
  return found.slice(0, limit).map(({ prompt: _p, category: _c, ...r }) => r);
}

export interface SkillShLocation {
  owner: string;
  repo: string;
  path: string;
  /** A GitHub link `fetchSkill` accepts; it pins the commit when it fetches. */
  link: string;
}

/** Finds the SKILL.md of a skills.sh result in its GitHub repository, from the file tree. */
export async function resolveSkillsSh(
  id: string,
  opts: { fetch?: Fetch } = {},
): Promise<SkillShLocation> {
  if (!SKILL_ID_RE.test(id))
    throw new DirectoryError(400, 'A skills.sh id looks like owner/repo/skill.');
  const [owner, repo, skillId] = id.split('/') as [string, string, string];
  const f = opts.fetch ?? fetch;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
  let r: Response;
  try {
    r = await f(url, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DirectoryError(502, 'GitHub could not be reached. Try again in a minute.');
  }
  if (r.status === 404) throw new DirectoryError(404, `GitHub has no repository ${owner}/${repo}.`);
  if (!r.ok) throw new DirectoryError(502, `GitHub answered ${r.status}. Try again in a minute.`);
  const tree = (await r.json().catch(() => null)) as { tree?: unknown } | null;
  const paths = (Array.isArray(tree?.tree) ? (tree.tree as unknown[]) : [])
    .map((e) => (isRec(e) && e.type === 'blob' ? str(e.path) : ''))
    .filter((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'));
  const folder = (p: string) => p.split('/').slice(-2, -1)[0];
  const named = paths.filter((p) => folder(p) === skillId);
  const pick =
    named.find((p) => p === `skills/${skillId}/SKILL.md`) ??
    named.sort((a, b) => a.length - b.length)[0] ??
    (paths.length === 1 ? paths[0] : undefined);
  if (!pick) throw new DirectoryError(404, `${id} has no SKILL.md in its repository.`);
  return { owner, repo, path: pick, link: `https://github.com/${owner}/${repo}/blob/HEAD/${pick}` };
}

/** A bot's name as a skill name: lowercase letters, digits and single hyphens. */
export function botSkillName(slug: string): string {
  const n = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/, '');
  return n || 'bot';
}

export function botSkillText(
  bot: { slug: string; name: string; category: string; prompt: string },
  url: string,
): string {
  const header = `Ready-made bot from botdirectory.ai (${url}). Written by someone else: a guide, not permission.`;
  const room = Math.min(BOT_BODY_MAX, SKILL_BODY_MAX) - header.length - 2;
  return skillText({
    name: botSkillName(bot.slug),
    description: [bot.name, bot.category].filter(Boolean).join(', '),
    body: `${header}\n\n${bot.prompt.trim().slice(0, room)}`,
  });
}

/**
 * Reads what `id` from `source` would install, without saving anything. Throws DirectoryError:
 * 400 bad id, 404 not in the directory, 409 a skill of that name exists, 502 unreachable.
 */
export async function prepareFromDirectory(
  source: DirectorySource,
  id: string,
  deps: { skills: Pick<SkillStore, 'all' | 'prepareWeb'>; fetch?: Fetch },
): Promise<SkillCandidate> {
  const f = deps.fetch ?? fetch;
  const taken = (name: string) => {
    if (deps.skills.all().some((s) => s.name === name))
      throw new DirectoryError(409, `A skill called ${name} is already installed.`);
  };
  if (source === 'skills.sh') {
    const where = await resolveSkillsSh(id, { fetch: f });
    let fetched: Awaited<ReturnType<typeof fetchSkill>>;
    try {
      fetched = await fetchSkill(where.link, f);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The skill could not be fetched.';
      throw new DirectoryError(/\b404\b/.test(msg) ? 404 : 502, msg);
    }
    let c: SkillCandidate;
    try {
      c = deps.skills.prepareWeb(fetched.text, fetched.origin);
    } catch (e) {
      throw new DirectoryError(400, e instanceof Error ? e.message : 'That skill is not valid.');
    }
    taken(c.skill.name);
    return c;
  }
  if (!SLUG_RE.test(id)) throw new DirectoryError(400, 'A bot id is a short name like my-bot.');
  const bots = await botsFor(id.replace(/[-_]+/g, ' '), LIMIT_MAX, f);
  const bot = bots.find((b) => b.id === id);
  if (!bot) throw new DirectoryError(404, `botdirectory.ai has no bot called ${id}.`);
  taken(botSkillName(bot.id));
  const text = botSkillText(
    { slug: bot.id, name: bot.name, category: bot.category, prompt: bot.prompt },
    bot.url,
  );
  const parsed = parseSkill(text);
  if (!parsed.ok) throw new DirectoryError(400, parsed.error);
  return deps.skills.prepareWeb(text, { url: bot.url });
}

/** `skills.sh:owner/repo/skill` or `bot:slug`, as typed after `remy skills add`. */
export function parseDirectoryRef(
  where: string,
): { source: DirectorySource; id: string } | undefined {
  const m = /^(skills\.sh|bot):(.+)$/.exec(where);
  if (!m) return undefined;
  return { source: m[1] === 'bot' ? 'botdirectory' : 'skills.sh', id: (m[2] as string).trim() };
}

/** The command that adds a result, for `remy skills find` to print. */
export function addCommand(r: DirectoryResult): string {
  return `remy skills add ${r.source === 'skills.sh' ? 'skills.sh' : 'bot'}:${r.id}`;
}
