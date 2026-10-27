// Key hints as text: the key in the normal colour, what it does muted, dots between. Used by the
// footer and every picker, so a hint reads the same wherever it appears.
import { Text } from 'ink';
import { createElement as h, type ReactElement } from 'react';
import { SYMBOLS, type Theme } from './theme.ts';

/** `Enter send · Esc clear` as [key, label] pairs. The key is the first word. */
export function splitHint(hint: string): [string, string][] {
  return hint
    .split(' · ')
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(' ');
      return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
    });
}

export function Hints(p: { hint: string; theme: Theme }): ReactElement {
  const { theme } = p;
  const parts = splitHint(p.hint);
  return h(
    Text,
    { wrap: 'truncate-end' },
    ...parts.flatMap(([key, label], i) => [
      i ? h(Text, { key: `d${i}`, ...theme.props('faint') }, ` ${SYMBOLS.dot} `) : null,
      h(Text, { key: `k${i}` }, key),
      label ? h(Text, { key: `l${i}`, ...theme.props('muted') }, ` ${label}`) : null,
    ]),
  );
}
