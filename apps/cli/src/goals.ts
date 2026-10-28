// What people mostly want help with, and what each answer changes: the example requests on the
// home screen, the tips, and the first task of the tour. Pure data and functions.
import { EXAMPLES } from './examples.ts';

export interface Goal {
  id: string;
  /** How it is listed in the tour and in /profile. */
  label: string;
  /** Fits "they mostly want help with ...". */
  phrase: string;
  examples: readonly string[];
  tip: string;
}

export const GOALS: readonly Goal[] = [
  {
    id: 'work',
    label: 'Work and email',
    phrase: 'work and email',
    examples: [
      'Draft a short, friendly reply declining a meeting',
      'Turn these rough notes into a clear update for my team',
    ],
    tip: 'Paste an email and say how you want to reply',
  },
  {
    id: 'research',
    label: 'Research',
    phrase: 'research',
    examples: [
      'Compare the three best note-taking apps in 5 bullets',
      'Research the three best standing desks under $400 and compare them',
    ],
    tip: 'Paste a link and ask Remy to summarise the page',
  },
  {
    id: 'files',
    label: 'Files and organising',
    phrase: 'files and organising',
    examples: [
      'Tidy the files in this folder by type',
      'Sort these files into a folder for each project',
    ],
    tip: 'Remy asks before it moves or deletes anything',
  },
  {
    id: 'coding',
    label: 'Coding',
    phrase: 'coding',
    examples: [
      'Explain what this small script does',
      'Find the bug in the function I attach with @',
    ],
    tip: 'Attach a script with @ and ask what it does',
  },
  {
    id: 'school',
    label: 'School',
    phrase: 'school',
    examples: [
      'Make a 5-question quiz on photosynthesis',
      'Turn my notes into a one-page study guide',
    ],
    tip: 'Paste your notes and ask for a quiz',
  },
];

const byId = new Map(GOALS.map((g) => [g.id, g]));

export const MAX_GOALS = 6;
export const MAX_CUSTOM_CHARS = 60;

/** The goal for a stored id; a typed goal has none. */
export const goalById = (id: string): Goal | undefined => byId.get(id);

/** Reads well in a list: the label of a known goal, the user's own words otherwise. */
export const goalLabel = (id: string): string => byId.get(id)?.label ?? id;

/** Fits "they mostly want help with ...". */
export const goalPhrase = (id: string): string => byId.get(id)?.phrase ?? id;

/** A typed goal as it is stored: one line, letters, numbers and light punctuation only. */
export function cleanCustomGoal(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{M}\p{N} .,'&/()+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CUSTOM_CHARS)
    .trim();
}

/** Known ids and cleaned typed goals, without repeats, at most `MAX_GOALS`. */
export function normalizeGoals(goals: readonly string[]): string[] {
  const out: string[] = [];
  for (const g of goals) {
    const v = byId.has(g) ? g : cleanCustomGoal(g);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MAX_GOALS);
}

/** Example requests for the prompt: one per chosen goal first, then the second of each, then the defaults. */
export function examplesFor(goals: readonly string[]): readonly string[] {
  const chosen = goals.map((g) => byId.get(g)).filter((g): g is Goal => Boolean(g));
  if (!chosen.length) return EXAMPLES;
  const out: string[] = [];
  for (let i = 0; i < 2; i++)
    for (const g of chosen) if (g.examples[i]) out.push(g.examples[i] as string);
  for (const e of EXAMPLES) if (out.length < 3 && !out.includes(e)) out.push(e);
  return out;
}

/** Tips that match the goals; the home screen mixes them in with the general ones. */
export const tipsFor = (goals: readonly string[]): string[] =>
  goals.flatMap((g) => {
    const tip = byId.get(g)?.tip;
    return tip ? [tip] : [];
  });

export interface SampleFile {
  path: string;
  content: string;
}

export interface FirstTask {
  goal: string;
  prompt: string;
  /** Written into the scratch folder before the task starts. */
  files: SampleFile[];
}

const SAMPLE_FILES: SampleFile[] = [
  { path: 'meeting-notes.txt', content: 'Weekly sync. Decided to ship on Friday.\n' },
  { path: 'budget.csv', content: 'item,cost\nhosting,24\ndomain,12\n' },
  { path: 'holiday.jpg', content: 'sample image placeholder\n' },
  { path: 'invoice-0142.pdf', content: 'sample invoice placeholder\n' },
  { path: 'draft-post.md', content: '# Draft\n\nA few ideas for the next post.\n' },
  { path: 'slides.pptx', content: 'sample slides placeholder\n' },
];

const SCRIPT: SampleFile = {
  path: 'script.py',
  content: `import sys


def count_words(path):
    with open(path) as f:
        words = f.read().split()
    freq = {}
    for w in words:
        w = w.lower().strip(".,!?")
        freq[w] = freq.get(w, 0) + 1
    return sorted(freq.items(), key=lambda kv: -kv[1])[:5]


if __name__ == "__main__":
    for word, n in count_words(sys.argv[1]):
        print(n, word)
`,
};

const TASKS: Record<string, Omit<FirstTask, 'goal'>> = {
  research: { prompt: 'Compare the three best note-taking apps in 5 bullets', files: [] },
  files: { prompt: 'Tidy these files into folders by type', files: SAMPLE_FILES },
  coding: {
    prompt: 'Explain what this small script does. It is in script.py.',
    files: [SCRIPT],
  },
  work: { prompt: 'Draft a short, friendly reply declining a meeting', files: [] },
  school: { prompt: 'Make a 5-question quiz on photosynthesis', files: [] },
};

/** The first task for the first known goal picked; research when none is known. */
export function firstTaskFor(goals: readonly string[]): FirstTask {
  const goal = goals.find((g) => g in TASKS) ?? 'research';
  return { goal, ...(TASKS[goal] as Omit<FirstTask, 'goal'>) };
}
