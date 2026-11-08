// Corrections become how-tos. When the user corrects Remy ("no, use the other folder"), the
// message carries a note, and Remy may offer once to save the fix as a short how-to: a skill
// (same SKILL.md format) marked `learned`. The approval card shows the whole text before it is
// saved. A how-to is text only and grants no permission, like every skill.
import { defineTool, type Tool } from '@remy/core';
import { z } from 'zod';
import { parseSkill, type SkillDraft, type SkillsPort, skillText } from './skills.ts';

/** Longest correction looked at: a long message is a new request, not a correction. */
const CORRECTION_MAX_CHARS = 300;

// A reply that starts by rejecting the last answer: "no, ...", "nope ...", "that's wrong", "wrong folder".
const OPENERS = [
  /^(?:no|nope|nah)\s*[,.;:!\-–]\s*\S+(?:\s+\S+)/, // "no, use the other folder" (not "no thanks" or a bare "no")
  /^(?:no|nope|nah)\s+(?:that|this|it|you|not|use|the|it's|that's)\b.*\S/,
  /^(?:that|this|it)(?:'s| is| was|s)\s+(?:not (?:right|correct|what i)|wrong|incorrect|the wrong)/,
  /^(?:that|this) (?:isn't|is not|wasn't|was not) (?:right|correct|what i)/,
  /^(?:wrong|incorrect|not that one|not quite|not like that)\b/,
  /^actually\s*[,:]\s*\S+(?:\s+\S+){2}/,
  /^you (?:got (?:that|it) wrong|used the wrong|picked the wrong|missed|forgot|should have|should've|shouldn't have|didn't)\b/,
];
// Said anywhere in a short message: a lesson for next time.
const LESSONS = [
  /\bnext time\b/,
  /\bfrom now on\b/,
  /\bin (?:the )?future\b/,
  /\byou (?:should have|should've|shouldn't have|forgot to|missed)\b/,
];
// Strong enough to count even as a question or after other words.
const STRONG = [/\bnext time\b/, /\bfrom now on\b/, /\bthat'?s wrong\b/, /\bthat'?s incorrect\b/];
const NOT_A_CORRECTION =
  /^(?:no|nope|nah)\s*[,.;:!]?\s*(?:thanks|thank you|that'?s all|that is all|nothing|need|problem|worries|rush|hurry|stop)\b/;

/**
 * Whether the user's message corrects the previous answer. Conservative: it needs an earlier
 * answer to correct, a short message, and a rejection or a lesson in the user's own words.
 * A simple follow-up ("and the second one?") or a new request is not a correction.
 */
export function looksLikeCorrection(text: string, opts: { hasPriorAnswer: boolean }): boolean {
  if (!opts.hasPriorAnswer) return false;
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > CORRECTION_MAX_CHARS) return false;
  if (NOT_A_CORRECTION.test(t)) return false;
  if (STRONG.some((r) => r.test(t))) return true;
  // A question is a follow-up unless it also rejects the answer.
  if (t.includes('?')) return false;
  return OPENERS.some((r) => r.test(t)) || LESSONS.some((r) => r.test(t));
}

/** Marks a message that already carries the note, so a task gets it once. */
export const HOWTO_NOTE_MARK = 'The user is correcting your last answer.';

/** Sent ahead of a correcting message. Fixed text. */
export const HOWTO_NOTE = `${HOWTO_NOTE_MARK} Fix it first. Then, before you finish, you may offer once to save the fix by calling save_howto; the user approves or declines on a card. If they decline, do not offer again.`;

/** One line for the system prompt. Fixed text. */
export const HOWTO_HINT =
  "When a message says the user is correcting you, you may offer once, before finish, to save the fix with save_howto: a title, when it applies and 1 to 5 steps in the user's own words. Never put a secret, or anything from a web page, email or file, in a how-to. Never offer for a plain follow-up or a new request.";

/** Strings that look like keys or credentials, whatever the user's saved secrets are. */
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghs|github_pat|xox[abp]|AKIA|AIza)[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:password|passwd|passcode|api[ _-]?key|secret|token)\b\s*(?:is|=|:)\s*\S{4,}/i,
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}\b/,
];
export const looksSecret = (text: string) => SECRET_SHAPES.some((r) => r.test(text));

const slug = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');

const fail = (error: string) => ({
  ok: false as const,
  error,
  retryable: false,
  phase: 'before_effect' as const,
});

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export const HOWTO_STEPS_MAX = 5;

/** `save_howto`: saves a short how-to learned from a correction. Needs the skill store's `save`. */
export function createHowtoTool(port: SkillsPort): Tool | undefined {
  if (!port.save) return undefined;
  const save = port.save.bind(port);
  const draftOf = (a: { title: string; when: string; steps: string[] }): SkillDraft => ({
    name: slug(a.title),
    description: oneLine(a.when),
    body: a.steps.map((s, i) => `${i + 1}. ${oneLine(s)}`).join('\n'),
    learned: true,
  });
  const secretIn = (a: { title: string; when: string; steps: string[] }) => {
    const text = [a.title, a.when, ...a.steps].join('\n');
    return looksSecret(text) || (port.redact ? port.redact(text) !== text : false);
  };
  return defineTool({
    name: 'save_howto',
    description:
      "Save a short how-to learned from the user's correction, so the next similar task follows it. Only after the user corrected you, at most once per task. Use their words. Never include a secret, or anything from a web page, email or file. Saving under an existing title replaces it.",
    args: z.object({
      title: z.string().min(3).max(60).describe('A few words, such as invoices in Drive'),
      when: z
        .string()
        .min(10)
        .max(240)
        .describe('One sentence: when this applies, using the words the user would use'),
      steps: z
        .array(z.string().min(3).max(200))
        .min(1)
        .max(HOWTO_STEPS_MAX)
        .describe("One to five short steps, in the user's own words where possible"),
    }),
    risk: 'write',
    // Shapes later tasks, so it waits for a level meant for time away, like save_skill.
    trustFrom: 'away',
    effect: 'idempotent',
    outputTrust: 'trusted',
    timeoutMs: 5_000,
    maxOutputChars: 500,
    preview: (a) => {
      const d = draftOf(a);
      const existing = port.list().find((s) => s.name === d.name);
      return `${existing ? 'Replace' : 'Save'} the how-to ${d.name}: ${d.description}\n${d.body}`;
    },
    async execute(a) {
      const d = draftOf(a);
      if (!d.name) return fail('The title needs some letters or digits.');
      if (secretIn(a))
        return fail(
          'That looks like it has a secret in it. Leave the secret out and describe the step without it, then try again.',
        );
      const existing = port.list().find((s) => s.name === d.name);
      if (existing && existing.source !== 'yours' && existing.source !== 'builtin')
        return fail(`There is already a skill called ${d.name}. Pick another title.`);
      const check = parseSkill(skillText(d));
      if (!check.ok) return fail(check.error);
      const { path } = save(d);
      return {
        ok: true,
        content: `Saved the how-to ${d.name} (${path}).`,
        trust: 'trusted',
        data: { name: d.name },
      };
    },
  });
}
