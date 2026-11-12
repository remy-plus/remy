import type { Tool, ToolContext } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { createHowtoTool, HOWTO_NOTE, looksLikeCorrection, looksSecret } from './howto.ts';
import {
  createSkillTools,
  parseSkill,
  type Skill,
  type SkillDraft,
  skillsBlock,
  skillText,
} from './skills.ts';

const yes = { hasPriorAnswer: true };

describe('the correction note', () => {
  it('asks for the offer outright, once, and never after a decline', () => {
    expect(HOWTO_NOTE).toContain('offer once');
    expect(HOWTO_NOTE).toContain('save_howto');
    expect(HOWTO_NOTE).toContain('do not offer again');
    expect(
      looksLikeCorrection(
        'No, the invoices are in Drive, not Downloads. Use Drive/Invoices/acme-march.txt.',
        {
          hasPriorAnswer: true,
        },
      ),
    ).toBe(true);
  });
});

describe('looksLikeCorrection', () => {
  it.each([
    'No, use the other folder',
    'no, the invoices are in Drive not Downloads',
    "That's wrong, the invoices are in Drive",
    'that is not right, it was last Friday',
    'Next time check the date first',
    'From now on put the total in the subject line',
    'Wrong folder.',
    'You forgot to attach the file',
    'Actually, I meant the second invoice from March',
    'nope, send it from my work address',
  ])('corrects: %s', (t) => expect(looksLikeCorrection(t, yes)).toBe(true));

  it.each([
    'And the second one?',
    'Thanks, now email it to Sam',
    'No thanks',
    'No problem, take your time',
    'no',
    'What about the invoices from May?',
    'Can you also summarise the attachment?',
    'Great, do the same for April',
    'Find the cheapest flight to Lisbon next week on Friday morning',
    `No, ${'x '.repeat(200)}`,
  ])('is not a correction: %s', (t) => expect(looksLikeCorrection(t, yes)).toBe(false));

  it('needs an earlier answer to correct', () => {
    expect(looksLikeCorrection('No, use the other folder', { hasPriorAnswer: false })).toBe(false);
  });
});

describe('looksSecret', () => {
  it('spots keys and passwords, not paths', () => {
    expect(looksSecret('use key sk-abcdefghijklmnop1234')).toBe(true);
    expect(looksSecret('the password is hunter2hunter')).toBe(true);
    expect(looksSecret('Bearer abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(looksSecret('log in with hunter2-Zebra-91')).toBe(true);
    expect(looksSecret('open Drive/Invoices-2026/acme-march.txt, the 2nd one')).toBe(false);
    expect(looksSecret('check Drive/Invoices-2026/final-reports-for-the-year first')).toBe(false);
  });
});

describe('save_howto', () => {
  const ctx = { taskId: 'task_1' } as ToolContext;
  function setup(existing: Skill[] = [], redact?: (t: string) => string) {
    const saved: SkillDraft[] = [];
    const port = {
      list: () => existing,
      save(d: SkillDraft) {
        saved.push(d);
        return { path: `/skills/${d.name}/SKILL.md` };
      },
      ...(redact && { redact }),
    };
    const tool = createHowtoTool(port) as Tool;
    return { tool, saved };
  }
  const args = {
    title: 'Invoices are in Drive',
    when: 'Finding an invoice or a receipt for the user',
    steps: [
      'Look in the Drive folder Invoices, not Downloads.',
      'Check the date before you open one.',
    ],
  };

  it('saves a learned how-to as numbered steps', async () => {
    const { tool, saved } = setup();
    const r = await tool.execute(tool.args.parse(args), ctx);
    expect(r.ok).toBe(true);
    expect(saved[0]).toMatchObject({ name: 'invoices-are-in-drive', learned: true });
    expect(saved[0]?.body).toBe(
      '1. Look in the Drive folder Invoices, not Downloads.\n2. Check the date before you open one.',
    );
    const parsed = parseSkill(skillText(saved[0] as SkillDraft));
    expect(parsed.ok && parsed.skill.learned).toBe(true);
  });

  it('saves one per task', async () => {
    const { tool, saved } = setup();
    await tool.execute(tool.args.parse(args), ctx);
    const again = await tool.execute(tool.args.parse({ ...args, title: 'Another one' }), ctx);
    expect(again.ok).toBe(false);
    expect(saved).toHaveLength(1);
  });

  it('shows the whole how-to on the card', () => {
    const { tool } = setup();
    expect(tool.preview?.(tool.args.parse(args))).toContain('2. Check the date');
  });

  it('allows one to five steps only', () => {
    const { tool } = setup();
    expect(tool.args.safeParse({ ...args, steps: [] }).success).toBe(false);
    expect(tool.args.safeParse({ ...args, steps: Array(6).fill('Do the thing') }).success).toBe(
      false,
    );
  });

  it('refuses a secret and saves nothing', async () => {
    const { tool, saved } = setup();
    const bad = { ...args, steps: ['Sign in with the key sk-abcdefghijklmnop1234 first.'] };
    const r = await tool.execute(tool.args.parse(bad), ctx);
    expect(r.ok).toBe(false);
    expect(saved).toEqual([]);
  });

  it('refuses a known secret from the redactor', async () => {
    const { tool, saved } = setup([], (t) => t.replaceAll('zebra-pass', '[REDACTED:X]'));
    const bad = { ...args, steps: ['Log in with zebra-pass when asked.'] };
    expect((await tool.execute(tool.args.parse(bad), ctx)).ok).toBe(false);
    expect(saved).toEqual([]);
  });

  it('does not overwrite a project skill', async () => {
    const project: Skill = {
      name: 'invoices-are-in-drive',
      description: 'x'.repeat(20),
      tools: [],
      body: '1. a',
      source: 'project',
    };
    const { tool } = setup([project]);
    expect((await tool.execute(tool.args.parse(args), ctx)).ok).toBe(false);
  });

  it('is absent where skills cannot be saved', () => {
    expect(createHowtoTool({ list: () => [] })).toBeUndefined();
    expect(createSkillTools({ list: () => [] })).toHaveLength(1);
  });
});

describe('learned how-tos in the skills block', () => {
  const learned: Skill = {
    name: 'invoices-are-in-drive',
    description: 'Finding an invoice or a receipt for the user',
    tools: [],
    body: '1. Look in the Drive folder Invoices.',
    source: 'yours',
    learned: true,
  };
  it('sends the steps with the message', () => {
    const block = skillsBlock([learned], 'find the invoice from March');
    expect(block).toContain('Follow these steps for this task: invoices-are-in-drive');
    expect(block).toContain('Drive folder Invoices');
  });
  it('does not for a skill that is not learned', () => {
    const block = skillsBlock([{ ...learned, learned: false }], 'find the invoice from March');
    expect(block).not.toContain('Follow these steps');
  });
  it('never for a skill from the web that claims to be learned', () => {
    const block = skillsBlock([{ ...learned, source: 'web' }], 'invoices-are-in-drive');
    expect(block).not.toContain('Follow these steps');
  });
});
