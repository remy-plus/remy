import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLogo, findMark, monogram } from './ui.tsx';

const mark = (id: string, name = id) => {
  const { container } = render(<AppLogo id={id} name={name} />);
  return container;
};

describe('AppLogo', () => {
  it('keeps the bundled mark for a known app', () => {
    const c = mark('github', 'GitHub');
    expect(c.querySelector('img')).not.toBeNull();
    expect(c.querySelector('[data-monogram]')).toBeNull();
  });

  it('shows the first letter, uppercased, for an unknown app', () => {
    const c = mark('acme-widgets', 'acme');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('[data-monogram]')?.textContent).toBe('A');
    expect(c.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has marks for the catalog and common apps by exact id', () => {
    for (const id of ['sentry', 'filesystem', 'fetch', 'memory', 'todoist', 'discord', 'x']) {
      expect(mark(id).querySelector('img'), id).not.toBeNull();
    }
  });

  it('puts a dark brand on a paper tile', () => {
    expect(mark('vercel').firstElementChild?.className).toContain('bg-[#edebe6]');
    expect(mark('discord').firstElementChild?.className).not.toContain('bg-[#edebe6]');
  });

  it('resolves registry-style ids and aliases', () => {
    expect(findMark('app.linear/linear')).toBe('linear');
    expect(findMark('com.atlassian/jira')).toBe('atlassian');
    expect(findMark('io.github.someone/todoist-mcp')).toBe('todoist');
    expect(findMark('gdrive')).toBe('drive');
    expect(findMark('google-drive')).toBe('drive');
    expect(findMark('postgres')).toBe('postgresql');
    expect(findMark('foo/bar', 'Jira Cloud')).toBe('atlassian');
    expect(findMark('twitter')).toBe('x');
    expect(findMark('x.com')).toBe('x');
    expect(mark('io.github.someone/todoist-mcp').querySelector('img')).not.toBeNull();
  });

  it('does not match by accident', () => {
    expect(findMark('io.github.foo/bar')).toBeUndefined();
    expect(findMark('xero-tools')).toBeUndefined();
    expect(findMark('x-ray-scanner')).toBeUndefined();
    expect(findMark('vector-memory-store')).toBeUndefined();
    expect(findMark('my-drive-sync')).toBeUndefined();
    expect(findMark('io.example/bravery')).toBeUndefined();
    expect(mark('xero-tools', 'Xero tools').querySelector('[data-monogram]')?.textContent).toBe(
      'X',
    );
  });

  it('handles odd names', () => {
    expect(monogram('123 app')).toBe('1');
    expect(monogram('  ')).toBe('·');
    expect(monogram('')).toBe('·');
    expect(monogram('é-mail')).toBe('É');
    expect(monogram('-- Zed')).toBe('Z');
  });
});
