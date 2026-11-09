import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelResponse } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { HOWTO_HINT, SKILLS_HINT } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { findCommand } from './commands.ts';
import { saveProfile } from './profile.ts';
import { openSkills, plainSkills } from './skills.ts';

let root: string;
let home: string;
let cwd: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'remy-skills-'));
  home = join(root, 'home');
  cwd = join(root, 'project');
  mkdirSync(home);
  mkdirSync(cwd);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const md = (name: string, description: string, body = '1. Do the thing.') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

function put(dir: string, folder: string, text: string, extra: Record<string, string> = {}) {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, 'SKILL.md'), text);
  for (const [n, t] of Object.entries(extra)) writeFileSync(join(dir, folder, n), t);
  return join(dir, folder);
}

describe('skill store, switching off', () => {
  it('hides a switched-off skill from list but not from all, and brings it back', () => {
    put(join(home, 'skills'), 'research', md('research', 'My own research steps'));
    const s = openSkills(home, cwd);
    expect(s.setEnabled('nobody', false)).toBe(false);
    expect(s.setEnabled('research', false)).toBe(true);
    expect(s.list().map((k) => k.name)).not.toContain('research');
    expect(s.all().map((k) => k.name)).toContain('research');
    expect(s.disabled()).toEqual(['research']);
    expect(plainSkills(s.all(), [], s.disabled())).toContain('[off] ');
    expect(s.setEnabled('research', true)).toBe(true);
    expect(s.list().map((k) => k.name)).toContain('research');
    expect(s.disabled()).toEqual([]);
  });
});

describe('skill store', () => {
  it('reads yours, the project and the built-ins, yours first by name', () => {
    put(join(home, 'skills'), 'research', md('research', 'My own research steps'));
    put(join(cwd, '.remy', 'skills'), 'deploy', md('deploy', 'Ship the site'));
    const s = openSkills(home, cwd);
    const byName = Object.fromEntries(s.list().map((k) => [k.name, k]));
    expect(byName.research?.source).toBe('yours');
    expect(byName.research?.description).toBe('My own research steps');
    expect(byName.deploy?.source).toBe('project');
    expect(byName['compare-and-buy']?.source).toBe('builtin');
  });

  it('skips and reports a skill that does not parse', () => {
    put(join(home, 'skills'), 'broken', 'no front matter');
    const s = openSkills(home, cwd);
    expect(s.list().map((k) => k.name)).not.toContain('broken');
    expect(s.problems()[0]?.error).toContain('front matter');
    expect(plainSkills(s.list(), s.problems())).toContain('Skipped');
  });

  it('adds only SKILL.md and removes only yours', () => {
    const src = put(
      join(root, 'src'),
      'weekly-report',
      md('weekly-report', 'Write the weekly report'),
      {
        'run.sh': 'rm -rf /',
      },
    );
    const s = openSkills(home, cwd);
    const c = s.prepare(src);
    expect(c.skipped).toEqual(['run.sh']);
    expect(c.replaces).toBe(false);
    s.install(c);
    expect(existsSync(join(home, 'skills', 'weekly-report', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, 'skills', 'weekly-report', 'run.sh'))).toBe(false);
    expect(s.list().find((k) => k.name === 'weekly-report')?.source).toBe('yours');
    expect(s.prepare(src).replaces).toBe(true);
    expect(s.remove('research')).toBe(false);
    expect(s.remove('../home')).toBe(false);
    expect(s.remove('weekly-report')).toBe(true);
  });

  it('does not read your own folder twice when started in REMY_HOME/..', () => {
    const s = openSkills(join(cwd, '.remy'), cwd);
    put(join(cwd, '.remy', 'skills'), 'mine', md('mine', 'Mine'));
    expect(s.list().find((k) => k.name === 'mine')?.source).toBe('yours');
  });
});

const usage = { inTokens: 10, outTokens: 5 };
const finish: ModelResponse = { calls: [{ tool: 'finish', args: { answer: 'Done.' } }], usage };

function harness(model?: ScriptedModelClient, ask?: (q: string) => Promise<string | null>) {
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home, REMY_KEYCHAIN: 'off' },
    cwd,
    out: (s) => {
      o.out += s;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: Boolean(ask),
    ...(ask && { ask }),
    store: new MemoryEventStore(),
    ...(model && { model }),
  };
  return async (...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, deps);
    return { code, ...o };
  };
}

describe('remy skills', () => {
  it('lists, shows, adds after a yes and removes', async () => {
    const src = put(
      join(root, 'src'),
      'tax-return',
      md('tax-return', 'File the yearly tax return'),
    );
    let asked = '';
    const run = harness(undefined, async (q) => {
      asked = q;
      return 'y';
    });
    expect((await run('skills')).out).toContain('research');
    expect((await run('skills', 'show', 'research')).out).toContain('primary sources');
    const added = await run('skills', 'add', src);
    expect(added.code).toBe(0);
    expect(added.out).toContain('File the yearly tax return');
    expect(asked).toContain('Add this skill?');
    expect((await run('skills', 'list')).out).toContain('Skills (yours)');
    expect((await run('skills', 'rm', 'tax-return')).out).toContain('Removed tax-return');
  });

  it('adds nothing on a no, and needs --yes without a terminal', async () => {
    const src = put(join(root, 'src'), 'tax-return', md('tax-return', 'File taxes'));
    const no = await harness(undefined, async () => 'n')('skills', 'add', src);
    expect(no.out).toContain('Nothing was added');
    const plain = harness();
    expect((await plain('skills', 'add', src)).err).toContain('--yes');
    expect((await plain('skills', 'add', src, '--yes')).code).toBe(0);
    expect(
      openSkills(home, cwd)
        .list()
        .find((k) => k.name === 'tax-return')?.source,
    ).toBe('yours');
  });

  it('is in the chat commands', () => {
    expect(findCommand('skills')?.summary).toContain('how-tos');
  });
});

describe('skills in a task', () => {
  it('lists the skills that fit with the message, adds the hint and offers use_skill', async () => {
    put(
      join(home, 'skills'),
      'tax-return',
      md('tax-return', 'Prepare and file the yearly tax return'),
    );
    const model = new ScriptedModelClient([finish]);
    await harness(model)('run', 'help me file my tax return');
    const req = model.requests[0];
    expect(req?.system).toContain(SKILLS_HINT);
    expect(req?.messages[0]?.content).toContain('Skills that may fit');
    expect(req?.messages[0]?.content).toContain('- tax-return:');
    expect(req?.tools.map((t) => t.name)).toContain('use_skill');
  });

  it('reads a skill with use_skill without asking', async () => {
    const use: ModelResponse = {
      calls: [{ tool: 'use_skill', args: { name: 'research' } }],
      usage,
    };
    const model = new ScriptedModelClient([use, finish]);
    const r = await harness(model)('run', 'research solar panels');
    expect(r.code).toBe(0);
    expect(JSON.stringify(model.requests[1]?.messages)).toContain('primary sources');
  });
});

describe('saved skills', () => {
  it('save_skill writes a skill after approval that the next task is offered', async () => {
    const save: ModelResponse = {
      calls: [
        {
          tool: 'save_skill',
          args: {
            name: 'tax-return',
            description: 'Prepare and file the yearly tax return',
            steps: '1. Gather the forms.\n2. Fill them in.',
          },
        },
      ],
      usage,
    };
    const run = harness(new ScriptedModelClient([save, finish]));
    const r = await run('run', 'save how we did the taxes as a skill');
    expect(r.out).toContain('Save the skill tax-return');
    const id = /task_[0-9a-f]{12}/.exec(r.out)?.[0] as string;
    await run('approve', id);
    expect(
      openSkills(home, cwd)
        .list()
        .find((k) => k.name === 'tax-return')?.source,
    ).toBe('yours');
    const model = new ScriptedModelClient([finish]);
    await harness(model)('run', 'file my tax return');
    expect(model.requests[0]?.messages[0]?.content).toContain('- tax-return:');
  });

  it('counts each read', async () => {
    const use: ModelResponse = {
      calls: [{ tool: 'use_skill', args: { name: 'research' } }],
      usage,
    };
    await harness(new ScriptedModelClient([use, finish]))('run', 'research it');
    expect(
      openSkills(home, cwd)
        .list()
        .find((k) => k.name === 'research')?.uses,
    ).toBe(1);
  });
});

describe('learned how-tos', () => {
  const profile = (personalise: boolean) =>
    saveProfile(home, { name: '', goals: [], createdAt: new Date().toISOString(), personalise });
  const how = {
    name: 'invoices-in-drive',
    description: 'Finding an invoice for the user',
    body: '1. Look in Drive.',
    learned: true,
  };

  it('are marked in the list and removable', () => {
    const s = openSkills(home, cwd);
    s.save(how);
    const k = s.list().find((x) => x.name === 'invoices-in-drive');
    expect(k).toMatchObject({ learned: true, source: 'yours' });
    expect(plainSkills(s.list())).toContain('[learned] Finding an invoice');
    expect(s.remove('invoices-in-drive')).toBe(true);
  });

  it('are offered as a tool with a hint only while personalising is on', async () => {
    profile(true);
    const on = new ScriptedModelClient([finish]);
    await harness(on)('run', 'find the invoice');
    expect(on.requests[0]?.tools.map((t) => t.name)).toContain('save_howto');
    expect(on.requests[0]?.system).toContain(HOWTO_HINT);
    profile(false);
    const off = new ScriptedModelClient([finish]);
    await harness(off)('run', 'find the invoice');
    expect(off.requests[0]?.tools.map((t) => t.name)).not.toContain('save_howto');
    expect(off.requests[0]?.system).not.toContain(HOWTO_HINT);
  });

  it('send their steps with a similar message', async () => {
    openSkills(home, cwd).save(how);
    const model = new ScriptedModelClient([finish]);
    await harness(model)('run', 'please find the invoice from March');
    expect(model.requests[0]?.messages[0]?.content).toContain('Look in Drive.');
  });
});
