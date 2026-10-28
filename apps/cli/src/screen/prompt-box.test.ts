import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT, withText } from '../input.ts';
import { createTheme } from '../theme.ts';
import { PromptBox, type PromptBoxProps, promptBoxRows } from './prompt-box.ts';

const theme = createTheme('none');
const props = (o: Partial<PromptBoxProps> = {}): PromptBoxProps => ({
  value: EMPTY_INPUT,
  theme,
  width: 40,
  maxRows: 6,
  focused: true,
  placeholder: 'Ask anything… "tidy this folder"',
  model: 'gpt-5-nano',
  provider: 'openai',
  ...o,
});
const frame = (p: PromptBoxProps) => {
  const app = render(h(PromptBox, p));
  const f = app.lastFrame() ?? '';
  app.unmount();
  return f.split('\n');
};

describe('PromptBox', () => {
  it('shows the placeholder, a padding row and the model and provider', () => {
    const lines = frame(props());
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('┃');
    expect(lines[1]).toContain('Ask anything… "tidy this folder"');
    expect(lines[3]).toBe('┃  gpt-5-nano · openai');
  });

  it('shows typed text with the cursor at its end', () => {
    const lines = frame(props({ value: withText('fix it') }));
    expect(lines[1]).toBe('┃  fix it▌');
  });

  it('grows with wrapped text up to the limit', () => {
    const long = withText('word '.repeat(40));
    expect(frame(props({ value: long })).length).toBe(4 + 5);
    expect(promptBoxRows(long, 40, 6)).toBe(9);
    expect(promptBoxRows(EMPTY_INPUT, 40, 6)).toBe(4);
  });

  it('says so when no model is connected', () => {
    expect(frame(props({ model: undefined, provider: undefined })).at(-1)).toContain(
      'not connected',
    );
  });
});
