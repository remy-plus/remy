// Code that runs inside the page. Kept as source text: the packages build without DOM types,
// and it must not depend on Playwright internals.

/**
 * Numbers every visible control (`data-remy-ref`), and returns the page's text and its controls.
 * Evaluates to `{ url, title, text, elements }` (a `PageSnapshot`).
 */
export const SNAPSHOT_SCRIPT = String.raw`(() => {
  const MAX = 300;
  const clip = (s, n) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  for (const el of document.querySelectorAll('[data-remy-ref]')) el.removeAttribute('data-remy-ref');

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
      if (t.trim()) return t;
    }
    if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.innerText).join(' ');
    const tag = el.tagName;
    if (tag === 'INPUT' && /^(submit|button|reset)$/i.test(el.type)) return el.value;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      const t = el.innerText;
      if (t && t.trim()) return t;
      const img = el.querySelector('img[alt]');
      if (img) return img.alt;
    }
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
  };
  const CARD = /cc-|card|cvc|cvv|csc|expir/i;
  const kindOf = (el) => {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'INPUT') {
      if (type === 'password') return 'password';
      if (/^(submit|image)$/.test(type)) return el.form ? 'submit' : 'button';
      if (/^(button|reset)$/.test(type)) return 'button';
      if (/^(checkbox|radio)$/.test(type)) return 'checkbox';
      if (/^(hidden|file|range|color)$/.test(type)) return 'other';
      if (CARD.test(el.getAttribute('autocomplete') || '') || CARD.test(el.name || '') || CARD.test(el.id || '')) return 'card';
      return 'textbox';
    }
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SELECT') return 'select';
    if (tag === 'BUTTON') return el.form && (type === '' || type === 'submit') ? 'submit' : 'button';
    if (el.isContentEditable || role === 'textbox' || role === 'searchbox' || role === 'combobox') return 'textbox';
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return 'checkbox';
    if (role === 'link') return 'link';
    if (role) return 'button';
    return 'other';
  };

  const forms = Array.from(document.forms);
  const sel = 'a[href],button,input,select,textarea,[contenteditable=""],[contenteditable="true"],' +
    '[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],' +
    '[role=switch],[role=textbox],[role=searchbox],[role=combobox]';
  const elements = [];
  for (const el of document.querySelectorAll(sel)) {
    if (elements.length >= MAX) break;
    if (el.disabled || el.getAttribute('aria-hidden') === 'true' || !visible(el)) continue;
    const kind = kindOf(el);
    if (kind === 'other') continue;
    const ref = elements.length + 1;
    el.setAttribute('data-remy-ref', String(ref));
    const item = {
      ref,
      kind,
      role: (
        el.getAttribute('role') ||
        (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'search' ? 'searchbox' : el.tagName)
      ).toLowerCase(),
      name: clip(labelOf(el), 80),
    };
    if (kind === 'link') item.href = el.href;
    if (kind === 'textbox') {
      const v = el.isContentEditable ? el.innerText : el.value;
      if (v) item.value = clip(v, 80);
    }
    const form = el.form || el.closest('form');
    if (form) {
      item.form = forms.indexOf(form);
      item.formMethod = (form.getAttribute('method') || 'get').toLowerCase() === 'post' ? 'post' : 'get';
    }
    elements.push(item);
  }
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(),
    elements,
  };
})()`;

/** Reads DuckDuckGo's HTML results page. Evaluates to `SearchHit[]`, or `null` for a bot check. */
export const DDG_RESULTS_SCRIPT = String.raw`(() => {
  if (document.querySelector('.anomaly-modal__modal, #challenge-form')) return null;
  const out = [];
  for (const r of document.querySelectorAll('.result:not(.result--ad)')) {
    const a = r.querySelector('a.result__a');
    if (!a) continue;
    let url = a.href;
    try {
      const u = new URL(url);
      const real = u.searchParams.get('uddg');
      if (real) url = real;
    } catch {}
    out.push({
      title: a.textContent.replace(/\s+/g, ' ').trim(),
      url,
      snippet: (r.querySelector('.result__snippet')?.textContent || '').replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
})()`;

/** Reads Bing's results page. Evaluates to `SearchHit[]`. */
export const BING_RESULTS_SCRIPT = String.raw`(() => {
  const out = [];
  for (const r of document.querySelectorAll('#b_results > li.b_algo')) {
    const a = r.querySelector('h2 a');
    if (!a) continue;
    let url = a.href;
    // Bing wraps results in a tracking link whose "u" holds the address in base64 after "a1".
    try {
      const u = new URL(url);
      const p = u.searchParams.get('u');
      if (u.pathname.startsWith('/ck/') && p && p.startsWith('a1'))
        url = atob(p.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
    } catch {}
    out.push({
      title: a.textContent.replace(/\s+/g, ' ').trim(),
      url,
      snippet: (r.querySelector('.b_caption p, p')?.textContent || '').replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
})()`;
