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

describe('AnswerText sources', () => {
  const sources = [
    'Sources:',
    'https://www.soundguys.com/best-headphones-1234/',
    'https://www.tomsguide.com/best-picks/headphones',
    'https://www.whathifi.com/best/headphones',
  ].join('\n');

  it('shows a source list as chips with site names, each opening in a new tab', () => {
    render(<AnswerText text={sources} />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['SoundGuys', "Tom's Guide", 'whathifi.com']);
    for (const l of links) {
      expect(l.getAttribute('target')).toBe('_blank');
      expect(l.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(links[0]?.getAttribute('href')).toBe('https://www.soundguys.com/best-headphones-1234/');
    expect(links[0]?.getAttribute('title')).toBe('https://www.soundguys.com/best-headphones-1234/');
    expect(links[0]?.getAttribute('aria-label')).toContain('https://www.soundguys.com');
    expect(screen.getByText('Sources:')).toBeTruthy();
  });

  it('shows a list of bare links as chips too', () => {
    render(<AnswerText text={'- https://www.soundguys.com/a\n- https://www.tomsguide.com/b'} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'SoundGuys',
      "Tom's Guide",
    ]);
  });

  it('shows a bare address inside a sentence as the site name', () => {
    render(<AnswerText text="The full review is at https://www.rtings.com/headphones/x today." />);
    expect(screen.getByRole('link').textContent).toBe('RTINGS');
    expect(screen.getByText(/The full review is at/).textContent).toContain('today.');
  });

  it('keeps the words of a labelled link', () => {
    render(<AnswerText text="Read [the guide](https://example.com/g) first." />);
    expect(screen.getByRole('link', { name: 'the guide' }).getAttribute('title')).toBe(
      'https://example.com/g',
    );
  });
});
