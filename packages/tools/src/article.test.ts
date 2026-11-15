import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleText, isNoise, linkDensity, parseHtml, pickMain, renderEl } from './article.ts';
import { htmlToText } from './html.ts';

const page = (name: string): string =>
  readFileSync(new URL(`./fixtures/pages/${name}.page`, import.meta.url), 'utf8');

const prose =
  'This is the real article text, written as full sentences, with commas, and enough length to count as content. '.repeat(
    6,
  );

describe('parseHtml', () => {
  it('copes with unclosed list items, paragraphs and stray close tags', () => {
    const root = parseHtml('<ul><li>one<li>two</ul></span><p>a<p>b');
    expect(renderEl(root)).toBe('- one\n- two\na\nb');
  });

  it('drops scripts, styles and comments', () => {
    const root = parseHtml('<!-- x --><script>evil()</script><style>a{}</style><p>kept</p>');
    expect(renderEl(root)).toBe('kept');
  });

  it('keeps attribute values containing > intact', () => {
    expect(renderEl(parseHtml('<a title="a > b" href="/">link</a> after'))).toBe('link after');
  });
});

describe('isNoise', () => {
  const el = (html: string) => {
    const root = parseHtml(html);
    const first = root.kids.find((k) => typeof k !== 'string');
    if (!first || typeof first === 'string') throw new Error('no element');
    return first;
  };

  it.each([
    '<nav>x</nav>',
    '<footer>x</footer>',
    '<aside>x</aside>',
    '<header>x</header>',
    '<div role="navigation">x</div>',
    '<div class="site-nav">x</div>',
    '<div class="siteNavigation">x</div>',
    '<div id="cookie-banner">x</div>',
    '<div class="newsletter-signup">x</div>',
    '<div class="share-bar">x</div>',
    '<div class="related-articles">x</div>',
    '<div class="sidebar">x</div>',
    '<ol class="breadcrumbs">x</ol>',
    '<div hidden>x</div>',
    '<div aria-hidden="true">x</div>',
    '<div style="display: none">x</div>',
  ])('removes %s', (html) => {
    expect(isNoise(el(html))).toBe(true);
  });

  it.each([
    '<div class="article-body">x</div>',
    '<div class="content">x</div>',
    '<table class="specs"><tr><td>x</td></tr></table>',
  ])('keeps %s', (html) => {
    expect(isNoise(el(html))).toBe(false);
  });

  it('keeps a header inside an article, where it holds the headline', () => {
    const root = parseHtml('<article><header><h1>Title</h1></header></article>');
    expect(renderEl(root)).toContain('Title');
  });

  it('keeps an element named like a menu if it holds the article itself', () => {
    const t = articleText(`<div class="menu-layout"><article><p>${prose}</p></article></div>`);
    expect(t).toContain('real article text');
  });
});

describe('linkDensity', () => {
  it('is high for a menu and low for prose', () => {
    expect(
      linkDensity(parseHtml('<ul><li><a href="/">Home</a><li><a href="/">News</a></ul>')),
    ).toBe(1);
    expect(linkDensity(parseHtml(`<p>${prose}<a href="/">one link</a></p>`))).toBeLessThan(0.1);
  });
});

describe('pickMain', () => {
  it('prefers article or main over the rest of the page', () => {
    const root = parseHtml(`<div>${prose}</div><main><p>${prose}${prose}</p></main>`);
    expect(pickMain(root)?.tag).toBe('main');
  });

  it('scores blocks by prose when there is no article or main', () => {
    const menu = `<ul>${'<li><a href="/">Menu item</a></li>'.repeat(12)}</ul>`;
    const root = parseHtml(
      `<div id="top">${menu}</div><div id="story"><p>${prose}</p><p>${prose}</p></div><div id="foot">${menu}</div>`,
    );
    expect(pickMain(root)?.id).toBe('story');
  });
});

describe('renderEl', () => {
  it('marks headings and list items and joins table cells with |', () => {
    const t = renderEl(
      parseHtml(
        '<h1>Best picks</h1><ul><li>Sony WH-CH720N $98</li></ul><table><tr><th>Model</th><th>Price</th></tr><tr><td>Anker Q45</td><td>$149</td></tr></table>',
      ),
    );
    expect(t).toBe('# Best picks\n- Sony WH-CH720N $98\nModel | Price\nAnker Q45 | $149');
  });

  it('drops an unlabelled wall of links but keeps a row of linked prices', () => {
    const wall = `<div>${'<a href="/">Reviews</a> '.repeat(5)}</div>`;
    const prices =
      '<div><a href="/a">Blue $549.00</a> <a href="/b">Red $549.00</a> <a href="/c">Green $549.00</a></div>';
    expect(renderEl(parseHtml(wall))).toBe('');
    expect(renderEl(parseHtml(prices))).toContain('$549.00');
  });
});

describe('articleText', () => {
  it('starts with the title and the content, not the menus', () => {
    const t = articleText(
      `<title>Best Widgets</title><nav><a href="/">Home</a><a href="/x">Deals</a></nav><div class="cookie-banner">We use cookies</div><article><h1>Best Widgets</h1><p>${prose}</p></article><footer>Copyright</footer>`,
    );
    expect(t.startsWith('Best Widgets')).toBe(true);
    expect(t).toContain('real article text');
    expect(t).not.toMatch(/Home|Deals|cookies|Copyright/);
  });

  it('falls back to the whole page when the pick is small', () => {
    const html =
      '<title>T</title><nav>Menu entry</nav><article><p>Short.</p></article><p>Other words here</p>';
    expect(articleText(html)).toBe(htmlToText(html));
    expect(articleText(html)).toContain('Menu entry');
  });

  it('does not throw on empty or broken input', () => {
    expect(articleText('')).toBe('');
    expect(articleText('<<<>>><div')).toBeTypeOf('string');
  });
});

interface Case {
  file: string;
  /** Real content that must be in the first 1,500 characters. */
  content: string[];
  /** Real content that must be within the first 3,000. */
  later?: string[];
  /** Menu and banner text that must not appear in the first 3,000. */
  menus: (string | RegExp)[];
}

const CASES: Case[] = [
  {
    file: 'soundguys-budget-anc',
    content: ['Anker Soundcore Space 2', 'JLab JBuds Lux ANC', 'EarFun Wave Pro', '1More SonoFlow'],
    menus: ['Browse earbuds', 'Compare Earbuds', 'Every editorial hub'],
  },
  {
    file: 'itechguides-budget-over-ear',
    content: ['Space Q45', 'CMF Headphone Pro'],
    menus: ['Black Friday Preview', 'Skip to content'],
  },
  {
    file: 'whathifi-cheap-anc',
    content: ['Active noise cancellation (ANC)', 'Bose QuietComfort Ultra'],
    later: ['Sony WH-CH730N', 'Reasons to buy'],
    menus: [
      'Skip to main content',
      'Hi-Fi speaker reviews',
      'Stereo amplifier reviews',
      'Sign out',
    ],
  },
  {
    file: 'tomsguide-cheap-headphones',
    content: ['best cheap headphones', 'maximum'],
    later: ['1More SonoFlow Pro', 'Reasons to avoid'],
    menus: ['Club Benefits', 'Exclusive Newsletters', 'Member Competitions'],
  },
  {
    file: 'guardian-news-article',
    content: ['Dan Milmo', 'fridge', 'Iranian hackers'],
    menus: ['Print subscriptions', 'UK edition', 'Hide expanded menu'],
  },
  {
    file: 'mdn-docs-article-element',
    content: ['self-contained composition', 'HTML article contents element'],
    menus: ['Layout cookbook', 'HTML cheatsheet', 'Markup languages'],
  },
  {
    file: 'apple-airpods-max-product',
    content: ['Buy AirPods Max 2', '$549.00'],
    menus: [/^Store$/m, /^Vision$/m, /^Entertainment$/m],
  },
];

describe('real pages (trimmed fixtures)', () => {
  it.each(CASES)('$file: content first, menus gone', ({ file, content, later, menus }) => {
    const text = articleText(page(file));
    const first = text.slice(0, 1_500);
    const first3k = text.slice(0, 3_000);
    for (const c of content) expect(first, `"${c}" in the first 1,500 characters`).toContain(c);
    for (const c of later ?? []) expect(first3k, `"${c}" in the first 3,000`).toContain(c);
    for (const m of menus) {
      if (typeof m === 'string') expect(first3k).not.toContain(m);
      else expect(first3k).not.toMatch(m);
    }
  });

  it('the old reader put the menus first on the review pages', () => {
    const old = htmlToText(page('whathifi-cheap-anc')).slice(0, 1_500);
    expect(old).toContain('Hi-Fi speaker reviews');
    expect(old).not.toContain('Active noise cancellation (ANC)');
  });
});
