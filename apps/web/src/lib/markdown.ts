// The small markdown Remy's answers actually use: paragraphs, lists, fenced code, quotes,
// headings, and inline code, bold, italics and links. No dependency and no HTML string: the
// parser returns nodes and React builds them, so a page's text can never become markup.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'p'; spans: Inline[] }
  | { kind: 'heading'; spans: Inline[] }
  | { kind: 'quote'; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string };

/** Only these schemes become links; anything else stays as the text the model wrote. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i;

export function safeHref(raw: string): string | undefined {
  const href = raw.trim();
  return SAFE_HREF.test(href) ? href : undefined;
}

/** A bare URL ends at whitespace; trailing sentence punctuation is not part of it. */
const trimUrl = (url: string): string => {
  let out = url.replace(/[.,;:!?]+$/, '');
  while (out.endsWith(')') && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0))
    out = out.slice(0, -1);
  return out;
};

// Order matters: code first, so markers inside it stay literal, then links, then bold, then
// italics, then a bare URL. `_` is left alone on purpose: snake_case is common in answers.
// Both link forms allow one level of nested brackets, so a Wikipedia address such as
// `.../Remy_(agent)` survives whole.
const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)|\*\*([^\n]+?)\*\*|\*([^*\n]+?)\*|(https?:\/\/[^\s<>]+)/g;

/** Splits one run of text into styled spans. */
export function inline(text: string): Inline[] {
  const spans: Inline[] = [];
  let at = 0;
  const push = (s: Inline) => {
    if (s.kind === 'text' && !s.text) return;
    spans.push(s);
  };
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > at) push({ kind: 'text', text: text.slice(at, start) });
    const [, code, label, href, strong, em, url] = m;
    if (code !== undefined) push({ kind: 'code', text: code });
    else if (label !== undefined && href !== undefined) {
      const safe = safeHref(href);
      push(safe ? { kind: 'link', text: label, href: safe } : { kind: 'text', text: label });
    } else if (strong !== undefined) push({ kind: 'strong', text: strong });
    else if (em !== undefined) push({ kind: 'em', text: em });
    else if (url !== undefined) {
      const trimmed = trimUrl(url);
      push({ kind: 'link', text: trimmed, href: trimmed });
      if (trimmed.length < url.length) push({ kind: 'text', text: url.slice(trimmed.length) });
    }
    at = start + m[0].length;
  }
  if (at < text.length) push({ kind: 'text', text: text.slice(at) });
  return spans;
}

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

const startsBlock = (line: string): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  QUOTE.test(line) ||
  BULLET.test(line) ||
  NUMBERED.test(line);

/** Parses an answer into blocks. Anything it does not recognise stays a paragraph. */
export function parseAnswer(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      i++; // the closing fence, or the end of the answer
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', spans: inline(heading[1] ?? '') });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] ?? '');
        if (!q) break;
        body.push(q[1] ?? '');
        i++;
      }
      blocks.push({ kind: 'quote', spans: inline(body.join(' ').trim()) });
      continue;
    }
    const ordered = !BULLET.test(line) && NUMBERED.test(line);
    if (BULLET.test(line) || ordered) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = (ordered ? NUMBERED : BULLET).exec(lines[i] ?? '');
        if (!m) break;
        items.push(inline(m[1] ?? ''));
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    // A paragraph runs to a blank line or the start of another block. Single newlines are soft
    // wraps, as in markdown, so they join with a space.
    const body: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (!next.trim() || startsBlock(next)) break;
      body.push(next);
      i++;
    }
    blocks.push({ kind: 'p', spans: inline(body.join(' ').trim()) });
  }
  return blocks;
}
