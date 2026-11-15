import { decodeEntities, htmlToText } from './html.ts';

/**
 * Main-content reading for pages: a small tolerant HTML tree, a readability-style pick of the
 * article, and a plain-text rendering of it. No dependencies. The result is still page text and
 * the caller keeps treating it as untrusted.
 */

export interface El {
  tag: string;
  id: string;
  cls: string;
  role: string;
  hidden: boolean;
  parent?: El;
  kids: (El | string)[];
}

const VOID = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'source',
  'wbr',
  'area',
  'col',
  'embed',
  'base',
  'track',
]);
const DROP_WHOLE =
  /<(script|style|noscript|template|svg|head|iframe|object|canvas|select|textarea|button|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const attr = (attrs: string, name: string): string => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    attrs,
  );
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};

const CLOSES: Record<string, { closes: Set<string>; stop: Set<string> }> = {
  li: { closes: new Set(['li']), stop: new Set(['ul', 'ol', 'menu']) },
  dt: { closes: new Set(['dt', 'dd']), stop: new Set(['dl']) },
  dd: { closes: new Set(['dt', 'dd']), stop: new Set(['dl']) },
  tr: { closes: new Set(['tr', 'td', 'th']), stop: new Set(['table']) },
  td: { closes: new Set(['td', 'th']), stop: new Set(['tr', 'table']) },
  th: { closes: new Set(['td', 'th']), stop: new Set(['tr', 'table']) },
};

/** A forgiving parse: unclosed tags close at their parent's end, stray close tags are ignored. */
export function parseHtml(html: string): El {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WHOLE, ' ');
  const root: El = { tag: '#root', id: '', cls: '', role: '', hidden: false, kids: [] };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    if (m[4] !== undefined) {
      cur.kids.push(m[4]);
      continue;
    }
    const tag = (m[2] ?? '').toLowerCase();
    const attrs = m[3] ?? '';
    if (m[1]) {
      for (let n: El | undefined = cur; n && n.tag !== '#root'; n = n.parent) {
        if (n.tag === tag) {
          cur = n.parent ?? root;
          break;
        }
      }
      continue;
    }
    const rule = CLOSES[tag];
    if (rule) {
      for (let n: El | undefined = cur; n && n.tag !== '#root'; n = n.parent) {
        if (rule.stop.has(n.tag)) break;
        if (rule.closes.has(n.tag)) {
          cur = n.parent ?? root;
          break;
        }
      }
    } else if (tag === 'p' && cur.tag === 'p') cur = cur.parent ?? root;
    const style = attr(attrs, 'style');
    const el: El = {
      tag,
      id: attr(attrs, 'id'),
      cls: attr(attrs, 'class'),
      role: attr(attrs, 'role').toLowerCase(),
      hidden:
        /(?:^|\s)hidden(?:\s|=|$)/i.test(attrs.replace(/"[^"]*"|'[^']*'/g, '""')) ||
        attr(attrs, 'aria-hidden') === 'true' ||
        /display\s*:\s*none/i.test(style),
      parent: cur,
      kids: [],
    };
    cur.kids.push(el);
    if (!VOID.has(tag) && !/\/\s*$/.test(attrs)) cur = el;
  }
  return root;
}

const NOISE_TAGS = new Set([
  'nav',
  'footer',
  'aside',
  'button',
  'select',
  'dialog',
  'input',
  'textarea',
  'menu',
]);
const NOISE_ROLES = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'dialog',
  'alertdialog',
  'search',
  'menu',
  'menubar',
]);
const NOISE_WORDS = new Set([
  'nav',
  'navbar',
  'navigation',
  'menu',
  'footer',
  'cookie',
  'cookies',
  'consent',
  'gdpr',
  'newsletter',
  'subscribe',
  'subscription',
  'signup',
  'share',
  'sharing',
  'social',
  'related',
  'sidebar',
  'breadcrumb',
  'breadcrumbs',
  'promo',
  'advert',
  'advertisement',
  'ad',
  'ads',
  'banner',
  'popup',
  'modal',
  'masthead',
  'toolbar',
  'comments',
  'skip',
  'trending',
  'recommended',
]);

/** Words in a class or id: `siteNav`, `site-nav` and `site_nav` all give site, nav. */
const words = (s: string): string[] =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const hasNoiseName = (e: El): boolean => words(`${e.cls} ${e.id}`).some((w) => NOISE_WORDS.has(w));

const MAIN_TAGS = new Set(['article', 'main']);
const isMainish = (e: El): boolean => MAIN_TAGS.has(e.tag) || e.role === 'main';

const contains = (e: El, test: (x: El) => boolean): boolean =>
  e.kids.some((k) => typeof k !== 'string' && (test(k) || contains(k, test)));

const insideMain = (e: El): boolean => {
  for (let p = e.parent; p; p = p.parent) if (isMainish(p)) return true;
  return false;
};

/** True for elements that are page furniture rather than content. */
export function isNoise(e: El): boolean {
  if (e.tag === 'html' || e.tag === 'body') return false;
  if (e.hidden) return true;
  if (NOISE_TAGS.has(e.tag)) return true;
  if (e.tag === 'header') return !insideMain(e);
  if (NOISE_ROLES.has(e.role)) return true;
  // A class says "menu" or "share" but this element holds the article itself: keep it.
  return hasNoiseName(e) && !contains(e, isMainish);
}

/** Removes furniture in place. */
export function prune(e: El): void {
  e.kids = e.kids.filter((k) => typeof k === 'string' || !isNoise(k));
  for (const k of e.kids) if (typeof k !== 'string') prune(k);
}

const flat = (e: El | string): string =>
  typeof e === 'string' ? e : e.kids.map(flat).join(e.tag === 'br' ? '\n' : ' ');

const textOf = (e: El): string => decodeEntities(flat(e)).replace(/\s+/g, ' ').trim();

const linkLen = (e: El): number =>
  e.kids.reduce<number>(
    (n, k) =>
      typeof k === 'string'
        ? n
        : n + (k.tag === 'a' ? textOf(k).replace(/\s/g, '').length : linkLen(k)),
    0,
  );

const find = (e: El, test: (x: El) => boolean, out: El[] = []): El[] => {
  for (const k of e.kids) {
    if (typeof k === 'string') continue;
    if (test(k)) out.push(k);
    find(k, test, out);
  }
  return out;
};

/** Link text as a share of all text: menus and "related" lists are nearly all links. */
export const linkDensity = (e: El): number => {
  const t = textOf(e).replace(/\s/g, '').length;
  return t === 0 ? 0 : Math.min(1, linkLen(e) / t);
};

/** Without an article tag: the block whose paragraphs hold the most prose (readability-style). */
function scoreBlocks(root: El): El | undefined {
  const scores = new Map<El, number>();
  const bump = (e: El | undefined, n: number) =>
    e && e.tag !== '#root' && scores.set(e, (scores.get(e) ?? 0) + n);
  for (const p of find(root, (x) => ['p', 'pre', 'blockquote', 'td', 'li'].includes(x.tag))) {
    const t = textOf(p);
    if (t.length < 25 || linkDensity(p) > 0.6) continue;
    const s = 1 + (t.match(/[,.;]/g)?.length ?? 0) + Math.min(Math.floor(t.length / 100), 3);
    bump(p.parent, s);
    bump(p.parent?.parent, s / 2);
  }
  let best: El | undefined;
  let bestScore = 0;
  for (const [e, s] of scores) {
    const adj = s * (1 - linkDensity(e));
    if (adj > bestScore) {
      best = e;
      bestScore = adj;
    }
  }
  return best;
}

/** The element that holds the page's real content, if one stands out. */
export function pickMain(root: El): El | undefined {
  const marked = find(root, isMainish);
  let best: El | undefined;
  let bestLen = 0;
  for (const m of marked) {
    const len = textOf(m).length * (1 - linkDensity(m));
    if (len > bestLen) {
      best = m;
      bestLen = len;
    }
  }
  return best && bestLen >= MIN_PICK ? best : scoreBlocks(root);
}

const HEADING = /^h([1-6])$/;
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'blockquote',
  'pre',
  'form',
  'br',
  'hr',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'details',
  'summary',
  'address',
  'fieldset',
]);

/** A block that is nothing but links (a menu nobody labelled) is dropped when rendering. */
const linkWall = (e: El): boolean => {
  if (!['ul', 'ol', 'div', 'section', 'p'].includes(e.tag)) return false;
  const t = textOf(e);
  // A row of linked prices (colours, sizes) is a product picker, not a menu.
  if (/[$£€]\s?\d/.test(t)) return false;
  return (
    t.length > 0 &&
    t.length < 600 &&
    linkDensity(e) > 0.85 &&
    find(e, (x) => x.tag === 'a').length >= 3
  );
};

/** One-line leftovers inside an article that are page chrome: share prompts, image credits, bullets. */
const CHROME_LINE =
  /^(?:[•·|–-]|share(?: this article)?|join the conversation|follow us|add us as a preferred source.*|subscribe to .{0,40}|sign up (?:to|for) .{0,60}|\(image credit:.*\)|latest videos from.*|advertisement|read more|skip to .*)$/i;

/** Plain text of an element: headings marked with #, list items with -, table rows joined with |. */
export function renderEl(root: El): string {
  const lines: string[] = [];
  let line = '';
  const flush = () => {
    const t = decodeEntities(line)
      .replace(/[ \t\r\f\v ]+/g, ' ')
      .trim();
    if (t) lines.push(t);
    line = '';
  };
  const walk = (e: El | string): void => {
    if (typeof e === 'string') {
      line += e;
      return;
    }
    if (e.tag === 'tr') {
      flush();
      const cells = e.kids
        .filter((k): k is El => typeof k !== 'string' && (k.tag === 'td' || k.tag === 'th'))
        .map(textOf)
        .filter(Boolean);
      if (cells.length) lines.push(cells.join(' | '));
      return;
    }
    if (linkWall(e)) return;
    const h = HEADING.exec(e.tag);
    const block = BLOCKS.has(e.tag) || h !== null;
    if (block) flush();
    if (h) line = `${'#'.repeat(Math.min(Number(h[1]), 3))} `;
    else if (e.tag === 'li') line = '- ';
    for (const k of e.kids) walk(k);
    if (block) flush();
  };
  walk(root);
  flush();
  return lines
    .filter((l) => !CHROME_LINE.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** The pick must hold at least this much text, or the whole page is read instead. */
export const MIN_PICK = 500;

/**
 * Readable text for an article, review or docs page: the title, then the main content, without
 * menus, footers, banners and related-link lists. Falls back to the whole page when no main
 * content stands out, so nothing is lost on unusual pages.
 */
export function articleText(html: string): string {
  try {
    const title = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const root = parseHtml(html);
    prune(root);
    const main = pickMain(root);
    if (main) {
      const body = renderEl(main);
      if (body.length >= MIN_PICK) {
        const [first = '', ...rest] = body.split('\n');
        const same = first.replace(/^#+\s*/, '') === title;
        return [title, same ? rest.join('\n') : body].filter(Boolean).join('\n\n');
      }
    }
  } catch {
    // fall through to the whole page
  }
  return htmlToText(html);
}
