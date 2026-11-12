import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { openSkills } from './skills.ts';
import { fakeNet, json, SHA } from './skills-directory.test-kit.ts';
import {
  addCommand,
  botSkillName,
  DirectoryError,
  parseDirectoryRef,
  prepareFromDirectory,
  resolveSkillsSh,
  searchBots,
  searchSkillsSh,
} from './skills-directory.ts';

describe('searching', () => {
  it('maps skills.sh results and drops malformed rows', async () => {
    const { f } = fakeNet();
    expect(await searchSkillsSh('pdf', { fetch: f })).toEqual([
      {
        source: 'skills.sh',
        id: 'anthropics/skills/pdf',
        name: 'pdf',
        description: '',
        detail: '227,931 installs',
        url: 'https://skills.sh/anthropics/skills/pdf',
      },
    ]);
  });

  it('maps bots with a 600 character preview and omits empty parts', async () => {
    const { f } = fakeNet();
    const [bot, ...more] = await searchBots('call', { fetch: f });
    expect(more).toEqual([]);
    expect(bot).toMatchObject({
      source: 'botdirectory',
      id: 'call-cost-saver',
      detail: 'Personal · Phone, Email',
      url: 'https://botdirectory.ai/bots/call-cost-saver',
    });
    expect(bot?.preview).toHaveLength(600);
    expect(addCommand(bot as never)).toBe('remy skills add bot:call-cost-saver');
  });

  it('caps the limit at 20', async () => {
    const { f, seen } = fakeNet();
    await searchSkillsSh('pdf', { fetch: f, limit: 500 });
    expect(seen[0]).toContain('limit=20');
  });

  it('says so in a sentence when a directory is down, never an empty list', async () => {
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(searchSkillsSh('pdf', { fetch: down })).rejects.toThrow(
      'skills.sh could not be reached. Try again in a minute.',
    );
    await expect(searchBots('x', { fetch: down })).rejects.toMatchObject({ status: 502 });
    const bad = async () => json({ nope: true });
    await expect(searchBots('x', { fetch: bad })).rejects.toThrow(DirectoryError);
    const five = async () => new Response('', { status: 503 });
    await expect(searchSkillsSh('x', { fetch: five })).rejects.toThrow('answered 503');
  });
});

describe('resolving a skills.sh skill', () => {
  it('prefers skills/<id>/SKILL.md from the repository tree', async () => {
    const { f } = fakeNet();
    expect(await resolveSkillsSh('anthropics/skills/pdf', { fetch: f })).toMatchObject({
      path: 'skills/pdf/SKILL.md',
      link: 'https://github.com/anthropics/skills/blob/HEAD/skills/pdf/SKILL.md',
    });
  });

  it('rejects a bad id and reports a missing skill or repository', async () => {
    const { f } = fakeNet();
    await expect(resolveSkillsSh('nope', { fetch: f })).rejects.toMatchObject({ status: 400 });
    await expect(resolveSkillsSh('anthropics/skills/zzz', { fetch: f })).rejects.toMatchObject({
      status: 404,
    });
    const gone = fakeNet({ '/git/trees/': () => new Response('', { status: 404 }) });
    await expect(resolveSkillsSh('a/b/c', { fetch: gone.f })).rejects.toMatchObject({
      status: 404,
    });
  });
});

function store() {
  return openSkills(mkdtempSync(join(tmpdir(), 'remy-dir-')), '/nonexistent-project');
}

describe('preparing and installing', () => {
  it('installs a skills.sh skill pinned to its commit, then refuses a second time', async () => {
    const { f } = fakeNet();
    const skills = store();
    const c = await prepareFromDirectory('skills.sh', 'anthropics/skills/pdf', {
      skills,
      fetch: f,
    });
    expect(c.origin?.commit).toBe(SHA);
    skills.install(c);
    expect(skills.web('pdf')?.origin.commit).toBe(SHA);
    await expect(
      prepareFromDirectory('skills.sh', 'anthropics/skills/pdf', { skills, fetch: f }),
    ).rejects.toMatchObject({ status: 409, message: 'A skill called pdf is already installed.' });
  });

  it('turns a bot into a text-only skill with a warning header and its address as origin', async () => {
    const { f } = fakeNet();
    const skills = store();
    const c = await prepareFromDirectory('botdirectory', 'call-cost-saver', { skills, fetch: f });
    expect(c.skill.name).toBe('call-cost-saver');
    expect(c.skill.description).toBe('Call Cost Saver, Personal');
    expect(c.skill.body).toContain(
      'Ready-made bot from botdirectory.ai (https://botdirectory.ai/bots/call-cost-saver). Written by someone else: a guide, not permission.',
    );
    expect(c.text.length).toBeLessThan(8_500);
    skills.install(c);
    expect(skills.web('call-cost-saver')?.origin.url).toBe(
      'https://botdirectory.ai/bots/call-cost-saver',
    );
    await expect(
      prepareFromDirectory('botdirectory', 'call-cost-saver', { skills, fetch: f }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('answers 404 for an unknown bot and 400 for a bad id', async () => {
    const { f } = fakeNet();
    const skills = store();
    await expect(
      prepareFromDirectory('botdirectory', 'missing-bot', { skills, fetch: f }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      prepareFromDirectory('botdirectory', '../x', { skills, fetch: f }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('sanitises bot names to the skill name rules', () => {
    expect(botSkillName('My_Bot  v2!')).toBe('my-bot-v2');
    expect(botSkillName('___')).toBe('bot');
  });
});

describe('the add forms', () => {
  it('reads skills.sh: and bot: references only', () => {
    expect(parseDirectoryRef('skills.sh:a/b/c')).toEqual({ source: 'skills.sh', id: 'a/b/c' });
    expect(parseDirectoryRef('bot:my-bot')).toEqual({ source: 'botdirectory', id: 'my-bot' });
    expect(parseDirectoryRef('https://github.com/a/b')).toBeUndefined();
    expect(parseDirectoryRef('./folder')).toBeUndefined();
  });
});

function runner(f: (u: string) => Promise<Response>, ask?: (q: string) => Promise<string | null>) {
  const root = mkdtempSync(join(tmpdir(), 'remy-dir-cli-'));
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(home);
  mkdirSync(cwd);
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home, REMY_KEYCHAIN: 'off' },
    cwd,
    out: (x) => {
      o.out += x;
    },
    err: (x) => {
      o.err += x;
    },
    isTTY: Boolean(ask),
    ...(ask && { ask }),
    store: new MemoryEventStore(),
    fetch: f as typeof fetch,
  };
  return async (...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, deps);
    return { code, home, cwd, ...o };
  };
}

describe('remy skills find and add', () => {
  it('finds in either directory and prints the exact add command', async () => {
    const run = runner(fakeNet().f);
    const a = await run('skills', 'find', 'pdf');
    expect(a.code).toBe(0);
    expect(a.out).toContain('pdf  (227,931 installs)');
    expect(a.out).toContain('remy skills add skills.sh:anthropics/skills/pdf');
    const b = await run('skills', 'find', 'call', '--bots');
    expect(b.out).toContain('Personal · Phone, Email');
    expect(b.out).toContain('remy skills add bot:call-cost-saver');
  });

  it('adds skills.sh:<id> after showing the source and a yes', async () => {
    let asked = '';
    const run = runner(fakeNet().f, async (q) => {
      asked = q;
      return 'y';
    });
    const r = await run('skills', 'add', 'skills.sh:anthropics/skills/pdf');
    expect(r.code).toBe(0);
    expect(r.out).toContain(`at commit ${SHA.slice(0, 12)}`);
    expect(asked).toContain('Add this skill?');
    expect(openSkills(r.home, r.cwd).web('pdf')?.origin.commit).toBe(SHA);
  });

  it('adds bot:<slug> with --yes and refuses a name already taken', async () => {
    const run = runner(fakeNet().f);
    expect((await run('skills', 'add', 'bot:call-cost-saver')).err).toContain('--yes');
    const r = await run('skills', 'add', 'bot:call-cost-saver', '--yes');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Written by someone else');
    const again = await run('skills', 'add', 'bot:call-cost-saver', '--yes');
    expect(again.err).toContain('A skill called call-cost-saver is already installed.');
  });

  it('says when a directory is down', async () => {
    const run = runner(async () => {
      throw new Error('offline');
    });
    const r = await run('skills', 'find', 'pdf');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('skills.sh could not be reached');
  });
});
