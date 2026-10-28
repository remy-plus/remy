// What an empty session shows: the name, the model and folder, and what to ask. The home
// screen replaces this later; until then it keeps the first frame from being blank.
import type { Theme } from '../theme.ts';
import { TAGLINE } from '../wordmark.ts';
import { BLANK, type Row, type RSpan, TEXT_INDENT } from './rows.ts';
import { shortenPath } from './status.ts';

const line = (...spans: RSpan[]): Row => ({ spans, inset: TEXT_INDENT, pad: 0 });

export function introRows(p: {
  theme: Theme;
  model?: string;
  workspace?: string;
  examples: readonly string[];
}): Row[] {
  const info = [p.model ?? 'not connected', p.workspace && shortenPath(p.workspace)]
    .filter(Boolean)
    .join(` ${p.theme.symbols.dot} `);
  return [
    BLANK,
    line({ text: 'REMY', bold: true }),
    line({ text: TAGLINE }),
    line({ text: info, role: 'muted' }),
    ...(p.model
      ? [
          BLANK,
          line({ text: 'Ask in your own words. For example', role: 'muted' }),
          ...p.examples.map((e) =>
            line({ text: `${p.theme.symbols.prompt} `, role: 'muted' }, { text: e }),
          ),
        ]
      : []),
  ];
}
