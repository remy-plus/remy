// `@path` file references in the chat input, as plain functions. Completion and reading go
// through the workspace's ScopedFs, so a reference can never leave the workspace.
import { fuzzyScore } from './commands.ts';

/** The `@word` the cursor is in, if any: it starts the text or follows whitespace. */
export function atToken(
  text: string,
  cursor: number,
): { start: number; query: string } | undefined {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, cursor));
  if (!m) return undefined;
  const query = m[1] as string;
  return { start: cursor - query.length - 1, query };
}

/** Puts the chosen path in place of the `@word`; a folder keeps going, a file ends with a space. */
export function applyMention(
  text: string,
  cursor: number,
  path: string,
): { text: string; cursor: number } {
  const tok = atToken(text, cursor);
  if (!tok) return { text, cursor };
  const insert = `@${path}${path.endsWith('/') ? '' : ' '}`;
  return {
    text: text.slice(0, tok.start) + insert + text.slice(cursor),
    cursor: tok.start + insert.length,
  };
}

/** Every `@path` in a message, in order, once each. Folders (a trailing slash) are skipped. */
export function mentionedPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
    const p = (m[1] as string).replace(/[.,;:!?)\]]+$/, '');
    if (p && !p.endsWith('/') && !out.includes(p)) out.push(p);
  }
  return out;
}

/** What a referenced file may add to a message. */
export const MAX_FILE_CHARS = 20_000;
export const MAX_FILES = 5;

/** A file's text for the model, cut to a size that fits, with a plain note when it was cut. */
export function fileContext(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content.trimEnd();
  return `${content.slice(0, MAX_FILE_CHARS)}\n[cut: first ${MAX_FILE_CHARS} of ${content.length} characters]`;
}

/** Entries under a typed prefix such as `src/ut`: folders first, then the best matches. */
export async function completePaths(
  fs: { list(path: string): Promise<{ name: string; dir: boolean }[]> },
  query: string,
  max = 40,
): Promise<string[]> {
  const slash = query.lastIndexOf('/');
  const dir = slash >= 0 ? query.slice(0, slash + 1) : '';
  let entries: { name: string; dir: boolean }[];
  try {
    entries = await fs.list(dir || '.');
  } catch {
    return [];
  }
  const word = query.slice(slash + 1);
  return entries
    .filter((e) => !e.name.startsWith('.') || word.startsWith('.'))
    .map((e) => ({ e, s: fuzzyScore(word, e.name) }))
    .filter((x): x is { e: { name: string; dir: boolean }; s: number } => x.s !== undefined)
    .sort(
      (a, b) => Number(b.e.dir) - Number(a.e.dir) || b.s - a.s || a.e.name.localeCompare(b.e.name),
    )
    .slice(0, max)
    .map((x) => `${dir}${x.e.name}${x.e.dir ? '/' : ''}`);
}
