const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•',
  middot: '·',
};

const codePoint = (n: number, raw: string): string => {
  try {
    return String.fromCodePoint(n);
  } catch {
    return raw;
  }
};

const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return codePoint(Number.parseInt(e.slice(2), 16), raw);
    if (e.startsWith('#')) return codePoint(Number(e.slice(1)), raw);
    return ENTITIES[e.toLowerCase()] ?? raw;
  });

const BLOCK =
  /<\/?(?:p|div|section|article|header|footer|main|nav|aside|ul|ol|li|table|tr|thead|tbody|blockquote|pre|form|h[1-6]|br|hr|dl|dt|dd|figure|figcaption)\b[^>]*>/gi;

/** Readable plain text from HTML: no scripts, styles or markup; block elements become new lines. */
export function htmlToText(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, '');
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  h = h
    .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, ' ')
    .replace(BLOCK, '\n')
    .replace(/<[^>]*>/g, '');
  const body = decode(h)
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [title, body].filter(Boolean).join('\n\n');
}
