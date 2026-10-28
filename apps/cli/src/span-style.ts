// How a markdown span looks as Ink <Text> props. Shared by the classic and full-screen chat.
import type { Span } from './markdown.ts';
import type { Theme } from './theme.ts';

export function spanProps(sp: Span, theme: Theme) {
  return {
    ...(sp.bold && { bold: true }),
    ...(sp.italic && { italic: true }),
    ...(sp.dim && theme.props('muted')),
    ...(sp.faint && theme.props('faint')),
    // Without colours, inline code is set apart by weight.
    ...(sp.code && (theme.level === 'none' ? { bold: true } : theme.props('code'))),
  };
}
