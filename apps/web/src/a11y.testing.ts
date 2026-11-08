// A small accessibility check for tests: every control has a name, there is one h1, forms have labels.
// It does not replace a real audit; it catches the common slips (an unlabelled button or field).
const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

export function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label?.trim()) return label.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map(textOf)
      .join(' ');
    if (t) return t;
  }
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    const wrapped = el.closest('label');
    if (wrapped && textOf(wrapped)) return textOf(wrapped);
    if (el.id) {
      const l = document.querySelector(`label[for="${el.id}"]`);
      if (l && textOf(l)) return textOf(l);
    }
    return '';
  }
  return textOf(el) || el.getAttribute('title') || '';
}

/** Returns a list of problems; an empty list means none were found. */
export function a11yProblems(root: ParentNode = document): string[] {
  const out: string[] = [];
  const controls = root.querySelectorAll(
    'button, a[href], input:not([type=hidden]), select, textarea, [role=switch], [role=radio]',
  );
  for (const el of controls) {
    if (!nameOf(el))
      out.push(`no name: <${el.tagName.toLowerCase()} ${el.className.toString().slice(0, 40)}>`);
  }
  const h1 = root.querySelectorAll('h1').length;
  if (h1 !== 1) out.push(`expected one h1, found ${h1}`);
  for (const el of root.querySelectorAll('[aria-hidden=true]'))
    if (el.querySelector('button, a[href], input'))
      out.push('focusable content inside aria-hidden');
  return out;
}
