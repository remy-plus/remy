// A Browser over fixture pages (URL -> HTML), for evals and tests. No real browser: controls are
// read from the HTML with the same kinds the page walker gives, and forms "send" into a log.
import { htmlToText } from '@remy/tools';
import type { Browser, ElementKind, PageElement, PageSnapshot, SearchHit } from './port.ts';

export interface FixturePress {
  url: string;
  name: string;
  /** Field values of the form the control sent, by field name. */
  fields: Record<string, string>;
}

export interface FixtureBrowserOptions {
  /** Where the page goes when the user signs in in the shown window. */
  signInTo?: string;
  search?: (query: string, count: number) => Promise<SearchHit[]>;
}

export interface FixtureBrowser extends Browser {
  /** Buttons pressed that send something (form posts and plain buttons). */
  readonly presses: FixturePress[];
  /** What was typed, by URL and field name. */
  readonly typed: { url: string; field: string; text: string }[];
}

interface Control extends PageElement {
  field?: string;
  action?: string;
}

const attrs = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g))
    out[(m[1] as string).toLowerCase()] = m[2] ?? '';
  for (const m of raw.matchAll(/(?:^|\s)([\w-]+)(?=\s|$)/g))
    out[(m[1] as string).toLowerCase()] ??= '';
  return out;
};
const inner = (html: string) => htmlToText(html).replace(/\s+/g, ' ').trim();
const CARD = /cc-|card|cvc|cvv|csc|expir/i;

function controls(html: string, base: string): Control[] {
  const out: Control[] = [];
  let form: { index: number; method: 'get' | 'post'; action: string } | undefined;
  let forms = 0;
  // Elements with content up to their own closing tag, or bare tags (inputs, form edges).
  const re =
    /<(?:(a|button|textarea|select)\b([^>]*)>([\s\S]*?)<\/\1\s*>|(\/form|form|input)\b([^>]*)>)/gi;
  for (const m of html.matchAll(re)) {
    const tag = (m[1] ?? m[4] ?? '').toLowerCase();
    const a = attrs(m[2] ?? m[5] ?? '');
    if (tag === '/form') {
      form = undefined;
      continue;
    }
    if (tag === 'form') {
      form = {
        index: forms++,
        method: a.method?.toLowerCase() === 'post' ? 'post' : 'get',
        action: new URL(a.action ?? '', base).href,
      };
      continue;
    }
    const text = inner(m[3] ?? '');
    const type = (a.type ?? '').toLowerCase();
    let kind: ElementKind;
    if (tag === 'a') {
      if (a.href === undefined) continue;
      kind = 'link';
    } else if (tag === 'button') kind = form && type !== 'button' ? 'submit' : 'button';
    else if (tag === 'textarea') kind = 'textbox';
    else if (tag === 'select') kind = 'select';
    else if (type === 'hidden') continue;
    else if (type === 'password') kind = 'password';
    else if (type === 'submit') kind = form ? 'submit' : 'button';
    else if (type === 'checkbox' || type === 'radio') kind = 'checkbox';
    else if (CARD.test(a.autocomplete ?? '') || CARD.test(a.name ?? '')) kind = 'card';
    else kind = 'textbox';
    const name =
      a['aria-label'] ||
      (tag === 'input' && type === 'submit' ? a.value : '') ||
      text ||
      a.placeholder ||
      a.title ||
      a.name ||
      '';
    out.push({
      ref: out.length + 1,
      kind,
      role: tag === 'input' && type === 'search' ? 'searchbox' : (a.role ?? tag),
      name,
      ...(kind === 'link' && { href: new URL(a.href ?? '', base).href }),
      ...(a.name && { field: a.name }),
      ...(form && { form: form.index, formMethod: form.method, action: form.action }),
    });
  }
  return out;
}

export function fixtureBrowser(
  web: Record<string, string>,
  opts: FixtureBrowserOptions = {},
): FixtureBrowser {
  const presses: FixturePress[] = [];
  const typed: { url: string; field: string; text: string }[] = [];
  let url: string | undefined;
  let els: Control[] = [];
  let values = new Map<number, string>();
  let last: PageSnapshot | undefined;
  let visible = false;

  const pageFor = (u: string) => web[u] ?? web[u.replace(/\/$/, '')];

  function go(target: string): PageSnapshot {
    const html = pageFor(target.split('?')[0] as string) ?? pageFor(target);
    if (html === undefined) throw new Error(`Could not open ${target}: HTTP 404`);
    url = target;
    els = controls(html, target);
    values = new Map();
    return snap();
  }

  function snap(): PageSnapshot {
    if (!url) throw new Error('No page is open. Use browser_open first.');
    const html = pageFor(url.split('?')[0] as string) ?? pageFor(url) ?? '';
    last = {
      url,
      title: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '',
      text: inner(html),
      elements: els.map(({ field: _f, action: _a, ...e }) => {
        const v = values.get(e.ref);
        return v !== undefined && e.kind === 'textbox' ? { ...e, value: v } : e;
      }),
    };
    return last;
  }

  function control(ref: number): Control {
    const c = els.find((e) => e.ref === ref);
    if (!c) throw new Error(`There is no element [${ref}] on the page now.`);
    return c;
  }

  function fieldsOf(form: number | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of els)
      if (e.form === form && e.field && values.has(e.ref))
        out[e.field] = values.get(e.ref) as string;
    return out;
  }

  function send(c: Control): PageSnapshot {
    const fields = fieldsOf(c.form);
    if (c.formMethod === 'get' && c.action) {
      const q = new URLSearchParams(fields).toString();
      return go(q ? `${c.action}?${q}` : c.action);
    }
    presses.push({ url: url as string, name: c.name, fields });
    return c.action && pageFor(c.action) !== undefined ? go(c.action) : snap();
  }

  return {
    presses,
    typed,
    get visible() {
      return visible;
    },
    current: () => last,
    async open(u) {
      return go(u);
    },
    async snapshot() {
      return snap();
    },
    async click(ref) {
      const c = control(ref);
      if (c.kind === 'link' && c.href) return go(c.href);
      if (c.kind === 'submit' || c.kind === 'button') return send(c);
      return snap();
    },
    async type(ref, text, submit) {
      const c = control(ref);
      values.set(ref, text);
      typed.push({ url: url as string, field: c.field ?? c.name, text });
      return submit ? send(c) : snap();
    },
    async search(query, count) {
      return opts.search ? opts.search(query, count) : [];
    },
    async show() {
      visible = true;
      if (opts.signInTo) go(opts.signInTo);
    },
    async hide() {
      visible = false;
    },
    async close() {},
  };
}
