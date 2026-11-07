// Helper roles from one Markdown file. Each `## name` section is a role: optional `Tools:` and
// `Act:` lines, and the rest is its instructions. A role only ever narrows what a helper may use;
// the permission rules in `helperPermissions` decide the rest. Bad input becomes a problem line
// for `remy doctor`, never an exception.

export type RoleSource = 'builtin' | 'user' | 'project';

export interface HelperRole {
  name: string;
  instructions: string;
  /** The tools it may use. Absent: every tool a helper could use anyway. */
  tools?: string[];
  /** It may ask to change things, with the user's approval each time. Needs the host's say-so. */
  act: boolean;
  source: RoleSource;
}

export interface ParsedRoles {
  roles: HelperRole[];
  /** One plain line each, with the line number. */
  problems: string[];
}

export const ROLE_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
export const MAX_ROLE_INSTRUCTIONS = 2000;

export const BUILTIN_ROLES: HelperRole[] = [
  {
    name: 'researcher',
    tools: ['web_search', 'fetch_url', 'browser_open', 'browser_look'],
    act: false,
    source: 'builtin',
    instructions:
      'Find the answer in sources you actually read. Prefer the primary page over a summary of it. Give each claim with the link it came from, and say plainly what you could not find.',
  },
  {
    name: 'checker',
    tools: ['read_file', 'list_files', 'web_search', 'fetch_url'],
    act: false,
    source: 'builtin',
    instructions:
      'You are given a draft. Find what is wrong or unsupported in it: claims with no source, numbers that do not match their source, things that contradict each other, and anything promised that was not done. Check against the sources where you can. List each problem with the exact words from the draft and what is wrong with it. If you find none, say what you checked.',
  },
];

const TRUE = new Set(['yes', 'true', 'on']);
const FALSE = new Set(['no', 'false', 'off']);

export function parseRoles(text: string, source: RoleSource): ParsedRoles {
  const roles: HelperRole[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  let cur: { name: string; line: number; body: string[] } | undefined;
  const flush = () => {
    if (!cur) return;
    const { name, line, body } = cur;
    cur = undefined;
    const label = `line ${line}: role "${name}"`;
    if (!ROLE_NAME.test(name))
      return void problems.push(
        `line ${line}: "${name}" is not a role name. Use letters, digits, - or _, starting with a letter.`,
      );
    if (seen.has(name)) return void problems.push(`${label} appears twice. The first one is used.`);
    let tools: string[] | undefined;
    let act = false;
    const rest: string[] = [];
    let failed = false;
    let inHead = true;
    for (const raw of body) {
      const m = inHead ? /^\s*(tools|act)\s*:\s*(.*?)\s*$/i.exec(raw) : null;
      if (m) {
        const key = (m[1] as string).toLowerCase();
        const val = m[2] as string;
        if (key === 'tools') {
          const list = val
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          if (!list.length) {
            problems.push(`${label} has an empty Tools line. List tool names, or remove the line.`);
            failed = true;
          } else tools = list;
        } else if (TRUE.has(val.toLowerCase())) act = true;
        else if (!FALSE.has(val.toLowerCase())) {
          problems.push(`${label}: Act must be yes or no, not "${val}".`);
          failed = true;
        }
      } else {
        if (raw.trim()) inHead = false;
        rest.push(raw);
      }
    }
    if (failed) return;
    let instructions = rest.join('\n').trim();
    if (!instructions)
      return void problems.push(`${label} has no instructions. Write what the helper should do.`);
    if (instructions.length > MAX_ROLE_INSTRUCTIONS) {
      problems.push(`${label} is longer than ${MAX_ROLE_INSTRUCTIONS} characters. It was cut.`);
      instructions = instructions.slice(0, MAX_ROLE_INSTRUCTIONS);
    }
    seen.add(name);
    roles.push({ name, instructions, ...(tools && { tools }), act, source });
  };

  lines.forEach((raw, i) => {
    const h = /^##\s+(.*?)\s*$/.exec(raw);
    if (h && !raw.startsWith('###')) {
      flush();
      cur = { name: (h[1] as string).toLowerCase(), line: i + 1, body: [] };
    } else if (cur) cur.body.push(raw);
    else if (raw.trim() && !/^#\s/.test(raw) && problems.length === 0)
      problems.push(`line ${i + 1}: text before the first "## name" heading is ignored.`);
  });
  flush();
  return { roles, problems };
}

/** Built-ins first, then the user's file, then the project's; a later source wins by name. */
export function mergeRoles(...lists: HelperRole[][]): HelperRole[] {
  const by = new Map<string, HelperRole>();
  for (const l of lists) for (const r of l) by.set(r.name, r);
  return [...by.values()];
}
