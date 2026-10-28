// The chat's slash commands in one place: autocomplete, the Ctrl+P palette and /help read this.

export interface CommandInfo {
  name: string;
  /** One line, outcome first. */
  summary: string;
  aliases?: string[];
  /** Keys that do the same thing, shown as a hint. */
  keys?: string;
}

export const COMMANDS: CommandInfo[] = [
  { name: 'model', summary: 'Switch the model', aliases: ['models'] },
  { name: 'login', summary: 'Connect a provider or replace a key' },
  { name: 'connect', summary: 'Add an app or service Remy can use' },
  { name: 'connections', summary: 'See connected apps; switch them off or remove them' },
  { name: 'approvals', summary: 'See the tools you always allow; stop allowing one' },
  { name: 'sessions', summary: 'Pick up an unfinished task', aliases: ['resume'] },
  { name: 'new', summary: 'Start a fresh conversation' },
  { name: 'clear', summary: 'Clear the screen and start fresh' },
  { name: 'thinking', summary: "Show or hide the model's reasoning summary" },
  {
    name: 'theme',
    summary: 'Switch between light and dark, or follow the terminal',
    aliases: ['light', 'dark', 'day', 'night'],
  },
  { name: 'minimal', summary: 'Use the quiet minimal screen at start (saved)' },
  { name: 'profile', summary: 'See or change what Remy knows about you' },
  { name: 'memory', summary: 'See what Remy remembers about you; edit or forget a note' },
  { name: 'tour', summary: 'Replay the welcome tour' },
  { name: 'help', summary: 'List commands and keys' },
  { name: 'exit', summary: 'Quit', aliases: ['quit'], keys: 'Ctrl+D' },
];

/** The command a typed name stands for, aliases included. */
export function findCommand(name: string): CommandInfo | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

/**
 * How well `query` matches `text`: undefined for no match, higher is better. Letters must appear
 * in order; a prefix and a run of neighbours score more. Case does not matter.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return 1000 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 500 - at;
  let score = 0;
  let from = 0;
  let run = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return undefined;
    run = i === from ? run + 1 : 0;
    score += 1 + run * 2 - Math.min(i - from, 5);
    from = i + 1;
  }
  return score;
}

/** Commands for what is typed after the `/`, best first. The name outranks the summary. */
export function matchCommands(query: string): CommandInfo[] {
  if (!query) return COMMANDS;
  const scored: { c: CommandInfo; s: number }[] = [];
  for (const c of COMMANDS) {
    const byName = Math.max(
      ...[c.name, ...(c.aliases ?? [])].map(
        (n) => fuzzyScore(query, n) ?? Number.NEGATIVE_INFINITY,
      ),
    );
    const bySummary = fuzzyScore(query, c.summary);
    const s = Number.isFinite(byName) ? byName + 1000 : bySummary;
    if (s !== undefined) scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}
