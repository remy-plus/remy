// Fetching a skill from a link. Only the user can do this, from `remy skills add`: no tool reaches
// it, so a page or an email cannot install a skill. Text only, pinned to a commit on GitHub.
import { isIP } from 'node:net';
import { isPrivateAddress, SKILL_BODY_MAX } from '@remy/tools';

export type SkillLocation =
  | { github: { owner: string; repo: string; ref: string; path: string } }
  | { file: string };

export interface SkillOrigin {
  url: string;
  /** The commit it was fetched at, on GitHub. A branch or tag can move; this cannot. */
  commit?: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const FILE = 'SKILL.md';
/** The body limit plus room for the front matter. */
const MAX_BYTES = SKILL_BODY_MAX + 4_000;

function checkAddress(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:') throw new Error('A skill link must start with https://.');
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isPrivateAddress(host)))
    throw new Error('A skill link must be a public address.');
}

export function resolveSkillUrl(link: string): SkillLocation {
  if (!URL.canParse(link)) throw new Error(`"${link}" is not a valid link.`);
  const url = new URL(link);
  checkAddress(url);
  if (url.hostname !== 'github.com') return { file: link };
  const [owner, repo, kind, ref, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo) throw new Error('That GitHub link has no repository in it.');
  const name = repo.replace(/\.git$/, '');
  if (!kind) return { github: { owner, repo: name, ref: 'HEAD', path: FILE } };
  if ((kind !== 'tree' && kind !== 'blob') || !ref)
    throw new Error('Use a GitHub link to a repository, a folder or a SKILL.md.');
  const path = rest.join('/');
  return {
    github: {
      owner,
      repo: name,
      ref,
      path: path.endsWith(FILE) ? path : [...rest, FILE].join('/'),
    },
  };
}

async function get(url: string, fetchImpl: Fetch): Promise<Response> {
  const r = await fetchImpl(url, { redirect: 'follow' });
  if (r.url) checkAddress(new URL(r.url));
  if (!r.ok) throw new Error(`${url} answered ${r.status}.`);
  return r;
}

async function read(r: Response): Promise<string> {
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error('That skill is too long.');
  return text;
}

export async function fetchSkill(
  link: string,
  fetchImpl: Fetch = fetch,
): Promise<{ text: string; origin: SkillOrigin }> {
  const where = resolveSkillUrl(link);
  if ('file' in where)
    return { text: await read(await get(where.file, fetchImpl)), origin: { url: link } };
  const { owner, repo, ref, path } = where.github;
  const api = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
  const { sha } = (await (await get(api, fetchImpl)).json()) as { sha: string };
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
  return { text: await read(await get(raw, fetchImpl)), origin: { url: link, commit: sha } };
}
