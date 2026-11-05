import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSkills, plainSkills } from './skills.ts';
import { fetchSkill, resolveSkillUrl } from './skills-web.ts';

const SKILL = '---\nname: rye\ndescription: Bake rye\n---\nSteps.';
const text = (body: string, status = 200) => new Response(body, { status });

describe('resolveSkillUrl', () => {
  it('reads a GitHub repository, folder or file', () => {
    expect(resolveSkillUrl('https://github.com/a/b')).toEqual({
      github: { owner: 'a', repo: 'b', ref: 'HEAD', path: 'SKILL.md' },
    });
    expect(resolveSkillUrl('https://github.com/a/b/tree/main/skills/rye')).toEqual({
      github: { owner: 'a', repo: 'b', ref: 'main', path: 'skills/rye/SKILL.md' },
    });
    expect(resolveSkillUrl('https://github.com/a/b/blob/v1/x/SKILL.md')).toEqual({
      github: { owner: 'a', repo: 'b', ref: 'v1', path: 'x/SKILL.md' },
    });
  });

  it('takes any other https link as the file itself', () => {
    expect(resolveSkillUrl('https://example.com/SKILL.md')).toEqual({
      file: 'https://example.com/SKILL.md',
    });
  });

  it('refuses plain http and local addresses', () => {
    expect(() => resolveSkillUrl('http://example.com/SKILL.md')).toThrow('https');
    expect(() => resolveSkillUrl('https://localhost/SKILL.md')).toThrow('public');
    expect(() => resolveSkillUrl('https://127.0.0.1/SKILL.md')).toThrow('public');
    expect(() => resolveSkillUrl('https://192.168.1.2/SKILL.md')).toThrow('public');
  });
});

describe('fetchSkill', () => {
  it('pins a GitHub skill to its commit', async () => {
    const asked: string[] = [];
    const got = await fetchSkill('https://github.com/a/b/tree/main/skills/rye', async (url) => {
      asked.push(String(url));
      return String(url).includes('api.github.com')
        ? Response.json({ sha: 'abc123' })
        : text(SKILL);
    });
    expect(got).toEqual({
      text: SKILL,
      origin: { url: 'https://github.com/a/b/tree/main/skills/rye', commit: 'abc123' },
    });
    expect(asked[1]).toBe('https://raw.githubusercontent.com/a/b/abc123/skills/rye/SKILL.md');
  });

  it('fetches a plain link', async () => {
    const got = await fetchSkill('https://example.com/SKILL.md', async () => text(SKILL));
    expect(got.origin).toEqual({ url: 'https://example.com/SKILL.md' });
  });

  it('refuses what is too big', async () => {
    const big = text('x'.repeat(40_000));
    await expect(fetchSkill('https://example.com/SKILL.md', async () => big)).rejects.toThrow(
      'too long',
    );
  });

  it('says plainly when the file is not there', async () => {
    await expect(
      fetchSkill('https://example.com/SKILL.md', async () => text('', 404)),
    ).rejects.toThrow('404');
  });

  it('refuses a redirect to somewhere private', async () => {
    const moved = async () =>
      Object.defineProperty(text(SKILL), 'url', { value: 'https://localhost/x' });
    await expect(fetchSkill('https://example.com/SKILL.md', moved)).rejects.toThrow('public');
  });
});

describe('a skill added from a link', () => {
  const setup = () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-skills-'));
    return openSkills(home, home);
  };
  const origin = { url: 'https://github.com/a/b', commit: 'abc' };

  it('is marked as from the web and remembered with its commit', () => {
    const store = setup();
    store.install(store.prepareWeb(SKILL, origin));
    expect(store.list().find((s) => s.name === 'rye')?.source).toBe('web');
    expect(store.web('rye')?.origin).toEqual(origin);
  });

  it('stops being from the web when removed', () => {
    const store = setup();
    store.install(store.prepareWeb(SKILL, origin));
    store.remove('rye');
    expect(store.web('rye')).toBeUndefined();
  });

  it('never runs through the save tool as a reviewed skill', () => {
    const store = setup();
    store.install(store.prepareWeb(SKILL, origin));
    expect(plainSkills(store.list())).toContain('Skills (from the web)');
  });
});
