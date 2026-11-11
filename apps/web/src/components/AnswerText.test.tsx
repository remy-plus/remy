import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnswerText } from './AnswerText.tsx';

afterEach(cleanup);

describe('AnswerText', () => {
  it('renders a link the model wrote as a real link that opens in a new tab', () => {
    render(<AnswerText text="I read [the report](https://example.com/report)." />);
    const link = screen.getByRole('link', { name: 'the report' });
    expect(link.getAttribute('href')).toBe('https://example.com/report');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders a bare URL as a link', () => {
    render(<AnswerText text="Source: https://example.com/a" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com/a');
  });

  it('renders a list as a list, not as lines of dashes', () => {
    render(<AnswerText text={'- one\n- two'} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('renders fenced code as code, with its markers intact', () => {
    render(<AnswerText text={'```\nconst a = **b**;\n```'} />);
    expect(screen.getByText('const a = **b**;').tagName).toBe('CODE');
  });

  it('never turns a refused scheme into a link', () => {
    render(<AnswerText text="[click](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('click')).toBeTruthy();
  });

  it('keeps the words of a plain answer', () => {
    render(<AnswerText text="All three quotes are in the file." />);
    expect(screen.getByText('All three quotes are in the file.')).toBeTruthy();
  });
});
